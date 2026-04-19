import twilio from 'twilio';
import { db } from '../db/connection.js';
import { notificationLogs, organizations, users, drivers, routes, plans } from '../db/schema.js';
import { eq, and, isNull, isNotNull, inArray } from 'drizzle-orm';

const SMS_TEMPLATES: Record<string, (d: Record<string, string>) => string> = {
  route_dispatched: (d) =>
    `Your prescription from ${d.pharmacyName} is out for delivery today. Track: ${d.trackingUrl}`,
  stop_approaching: (d) =>
    `Your delivery is ${d.stopsAway} stops away (~${d.etaMin} min). Track: ${d.trackingUrl}`,
  stop_arrived: (d) =>
    `${d.driverName} from ${d.pharmacyName} has arrived at your address.`,
  stop_completed: (d) =>
    `Your prescription has been delivered. Questions? Call ${d.pharmacyPhone}`,
  stop_failed: (d) =>
    `We couldn't complete your delivery. Please call ${d.pharmacyPhone} to reschedule.`,
  stop_rescheduled: (d) =>
    `We were unable to deliver today. Your prescription will be rescheduled. Questions? Call ${d.pharmacyPhone}`,
  eta_updated: (d) =>
    `Your delivery ETA updated to ~${d.etaMin} min. Track: ${d.trackingUrl}`,
};

// Maps stop status DB values → SMS template keys.
// sendStopNotification is called with the raw DB status value; this resolves it to the template.
// P-COMP9: 4 patient SMS milestones — en_route, arrived, completed, failed
const STATUS_TO_SMS_EVENT: Record<string, string> = {
  en_route: 'route_dispatched', // "Your prescription is out for delivery today"
  arrived: 'stop_arrived',
  completed: 'stop_completed',
  failed: 'stop_failed',
  rescheduled: 'stop_rescheduled',
};

let twilioClient: ReturnType<typeof twilio> | null = null;
function getClient() {
  if (!twilioClient) {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
  }
  return twilioClient;
}

export async function sendStopNotification(
  stop: {
    id: string;
    orgId: string;
    recipientPhone: string;
    trackingToken: unknown;
    routeId?: string | null;
    status?: string;
  },
  event: string,
  extra: Record<string, string> = {},
): Promise<void> {
  const resolvedEvent = STATUS_TO_SMS_EVENT[event] ?? event;
  const template = SMS_TEMPLATES[resolvedEvent];
  if (!template || !stop.recipientPhone) return;

  // Fetch org name + driver name in parallel (org phone on depots, not orgs — use fallback)
  const [orgRow, driverRow] = await Promise.all([
    db.select({ name: organizations.name })
      .from(organizations).where(eq(organizations.id, stop.orgId)).limit(1)
      .then(r => r[0]),
    stop.routeId
      ? db.select({ name: drivers.name })
          .from(drivers)
          .innerJoin(routes, eq(routes.driverId, drivers.id))
          .where(eq(routes.id, stop.routeId))
          .limit(1)
          .then(r => r[0])
      : Promise.resolve(undefined),
  ]);

  const trackingUrl = `${process.env.DASHBOARD_URL ?? 'https://app.mydashrx.com'}/track/${String(stop.trackingToken)}`;

  const body = template({
    pharmacyName: orgRow?.name ?? 'Your Pharmacy',
    pharmacyPhone: 'your pharmacy', // depot phone deferred — org table has no phone field

    driverName: driverRow?.name ?? 'Your driver',
    trackingUrl,
    stopsAway: '2',
    etaMin: '20',
    ...extra,
  });

  try {
    const msg = await getClient().messages.create({
      body,
      from: process.env.TWILIO_FROM_NUMBER!,
      to: stop.recipientPhone,
    });
    await db.insert(notificationLogs).values({
      stopId: stop.id,
      event: resolvedEvent,
      channel: 'sms',
      recipient: stop.recipientPhone,
      status: 'sent',
      externalId: msg.sid,
    });
  } catch (err) {
    await db.insert(notificationLogs).values({
      stopId: stop.id,
      event: resolvedEvent,
      channel: 'sms',
      recipient: stop.recipientPhone,
      status: 'failed',
    });
    console.error('SMS notification failed:', err);
  }
}

/**
 * P-DISP8: ETA-delta patient SMS — fires when ETA shifts >15min with 30-min cooldown
 * Only fires for pending stops within 5-120min window. HIPAA §164.506(c)(1) treatment comms.
 */
export async function sendEtaDeltaSms(
  stop: {
    id: string;
    orgId: string;
    recipientPhone: string;
    trackingToken: unknown;
    status: string;
    lastEtaMinutes?: number | null;
    lastEtaNotifiedAt?: Date | null;
  },
  newEtaMinutes: number,
): Promise<void> {
  // Only fire for pending/en_route stops
  if (stop.status !== 'pending' && stop.status !== 'en_route') return;
  // Only notify for meaningful ETAs (5-120min window)
  if (newEtaMinutes < 5 || newEtaMinutes > 120) return;
  // Check suppression: same phone must not be sending too often
  const { isSuppressed } = await import('../lib/emailHelpers.js');
  const suppressed = await isSuppressed(stop.recipientPhone);
  if (suppressed) return;
  // Only fire if ETA shifted >15min
  const previousEta = stop.lastEtaMinutes ?? null;
  if (previousEta !== null && Math.abs(newEtaMinutes - previousEta) <= 15) return;
  // 30-min cooldown since last ETA notification
  if (stop.lastEtaNotifiedAt) {
    const diffMs = Date.now() - new Date(stop.lastEtaNotifiedAt).getTime();
    if (diffMs < 30 * 60 * 1000) return;
  }
  // Build SMS message
  const trackingUrl = `${process.env.DASHBOARD_URL ?? 'https://app.mydashrx.com'}/track/${String(stop.trackingToken)}`;
  const body = `Your delivery ETA has changed. New estimated arrival: ${newEtaMinutes} minutes. Track: ${trackingUrl}`;
  try {
    const msg = await getClient().messages.create({ body, from: process.env.TWILIO_FROM_NUMBER!, to: stop.recipientPhone });
    // Update last_eta_notified_at + last_eta_minutes on the stop
    const { sql: drizzleSql } = await import('drizzle-orm');
    db.execute(drizzleSql`
      UPDATE stops SET last_eta_notified_at = now(), last_eta_minutes = ${newEtaMinutes}
      WHERE id = ${stop.id}
    `).catch(() => {});
    await db.insert(notificationLogs).values({
      stopId: stop.id, event: 'eta_updated', channel: 'sms',
      recipient: stop.recipientPhone, status: 'sent', externalId: msg.sid,
    });
  } catch (err) {
    console.error('ETA SMS failed:', err);
  }
}

/** Generic SMS sender — used by services that don't need templating (e.g. copay links) */
export async function sendTwilioSms(to: string, body: string): Promise<void> {
  const msg = await getClient().messages.create({ body, from: process.env.TWILIO_FROM_NUMBER!, to });
  console.log(JSON.stringify({ event: 'sms_sent', to, sid: msg.sid }));
}

export async function sendDriverArrivalEmail(stop: {
  id: string;
  orgId: string;
  recipientName: string;
  address: string;
  arrivedAt?: Date | null;
}): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  const senderDomain = process.env.SENDER_DOMAIN ?? 'mydashrx.com';
  if (!resendKey) return;

  const [org] = await db.select({ name: organizations.name })
    .from(organizations).where(eq(organizations.id, stop.orgId)).limit(1);

  const recipients = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(and(
      eq(users.orgId, stop.orgId),
      inArray(users.role, ['pharmacist', 'pharmacy_admin'] as const),
      isNull(users.deletedAt),
    ));

  if (recipients.length === 0) return;

  const arrivedTime = stop.arrivedAt
    ? new Date(stop.arrivedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Detroit' })
    : 'just now';

  const dashboardUrl = process.env.DASHBOARD_URL ?? 'https://app.mydashrx.com';
  const orgName = org?.name ?? 'Your Pharmacy';

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#fff;">
      <div style="background:#0F4C81;border-radius:12px;padding:20px 24px;margin-bottom:20px;">
        <h2 style="color:#fff;margin:0;font-size:18px;">Driver Has Arrived</h2>
        <p style="color:#9fc3e8;margin:4px 0 0;font-size:13px;">${orgName}</p>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;width:100px;">Recipient</td>
            <td style="padding:8px 0;font-weight:600;color:#111827;">${stop.recipientName}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Address</td>
            <td style="padding:8px 0;color:#374151;font-size:14px;">${stop.address}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Arrived at</td>
            <td style="padding:8px 0;color:#374151;font-size:14px;">${arrivedTime}</td></tr>
      </table>
      <a href="${dashboardUrl}/pharmacist/queue" style="display:inline-block;margin-top:20px;background:#0F4C81;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:500;">
        View Queue
      </a>
      <p style="color:#9ca3af;font-size:11px;margin-top:20px;">MyDashRx · Sent to pharmacists at ${orgName}</p>
    </div>`;

  await Promise.allSettled(recipients.map(r =>
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: `MyDashRx <noreply@${senderDomain}>`,
        to: r.email,
        subject: `Driver arrived — ${stop.recipientName} · ${stop.address.split(',')[0]}`,
        // P-DEL13: suppress tracking — operational emails contain patient address data
        track_clicks: false,
        track_opens: false,
        html,
      }),
    })
  ));
}

export async function sendRouteCompleteSummaryEmail(params: {
  orgId: string;
  driverName: string;
  completedAt: Date;
  totalStops: number;
  completedCount: number;
  failedCount: number;
  failedAddresses: string[];
}): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  const senderDomain = process.env.SENDER_DOMAIN ?? 'mydashrx.com';
  if (!resendKey) return;

  const [org] = await db.select({ name: organizations.name })
    .from(organizations).where(eq(organizations.id, params.orgId)).limit(1);

  const recipients = await db
    .select({ email: users.email })
    .from(users)
    .where(and(
      eq(users.orgId, params.orgId),
      inArray(users.role, ['dispatcher', 'pharmacy_admin'] as const),
      isNull(users.deletedAt),
    ));

  if (recipients.length === 0) return;

  const completedTime = params.completedAt.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/Detroit',
  });
  const dashboardUrl = process.env.DASHBOARD_URL ?? 'https://app.mydashrx.com';
  const orgName = org?.name ?? 'Your Pharmacy';

  const failedRows = params.failedAddresses.length > 0
    ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px;vertical-align:top;width:100px;">Failed stops</td>
       <td style="padding:8px 0;color:#dc2626;font-size:14px;">${params.failedAddresses.map(a => `• ${a}`).join('<br>')}</td></tr>`
    : '';

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#fff;">
      <div style="background:#0F4C81;border-radius:12px;padding:20px 24px;margin-bottom:20px;">
        <h2 style="color:#fff;margin:0;font-size:18px;">Route Completed</h2>
        <p style="color:#9fc3e8;margin:4px 0 0;font-size:13px;">${orgName}</p>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;width:100px;">Driver</td>
            <td style="padding:8px 0;font-weight:600;color:#111827;">${params.driverName}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Completed at</td>
            <td style="padding:8px 0;color:#374151;font-size:14px;">${completedTime}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Stops</td>
            <td style="padding:8px 0;color:#374151;font-size:14px;">${params.completedCount} delivered / ${params.failedCount} failed / ${params.totalStops} total</td></tr>
        ${failedRows}
      </table>
      <a href="${dashboardUrl}/dispatcher" style="display:inline-block;margin-top:20px;background:#0F4C81;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:500;">
        View Dashboard
      </a>
      <p style="color:#9ca3af;font-size:11px;margin-top:20px;">MyDashRx · Sent to dispatchers at ${orgName}</p>
    </div>`;

  await Promise.allSettled(recipients.map(r =>
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: `MyDashRx <noreply@${senderDomain}>`,
        to: r.email,
        subject: `Route complete — ${params.driverName} · ${params.completedCount}/${params.totalStops} delivered`,
        // P-DEL13: suppress tracking — operational emails with driver/stop context
        track_clicks: false,
        track_opens: false,
        html,
      }),
    })
  ));
}

export async function sendRouteReadyNotifications(planId: string, orgId: string): Promise<void> {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM_NUMBER) return;

  const [planRow] = await db
    .select({ date: plans.date })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.orgId, orgId)))
    .limit(1);
  if (!planRow) return;

  const [orgRow] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  const pharmacyName = orgRow?.name ?? 'Your pharmacy';

  const assignedRoutes = await db
    .select({ driverId: routes.driverId, stopOrder: routes.stopOrder })
    .from(routes)
    .where(and(eq(routes.planId, planId), isNull(routes.deletedAt), isNotNull(routes.driverId)));

  if (assignedRoutes.length === 0) return;

  const driverIds = assignedRoutes.map(r => r.driverId).filter((id): id is string => !!id);

  const driverRows = await db
    .select({ id: drivers.id, name: drivers.name, phone: drivers.phone })
    .from(drivers)
    .where(and(inArray(drivers.id, driverIds), isNull(drivers.deletedAt)));

  const stopCountByDriver = new Map<string, number>(
    assignedRoutes.map(r => [r.driverId!, (r.stopOrder as string[]).length])
  );

  await Promise.all(
    driverRows
      .filter(d => d.phone?.trim())
      .map(async (driver) => {
        const stopCount = stopCountByDriver.get(driver.id) ?? 0;
        const body = `Hi ${driver.name.split(' ')[0]}, your ${pharmacyName} delivery route for ${planRow.date} is ready — ${stopCount} stop${stopCount !== 1 ? 's' : ''}. Open the app to start your route.`;
        try {
          await getClient().messages.create({
            from: process.env.TWILIO_FROM_NUMBER!,
            to: driver.phone!,
            body,
          });
        } catch (err) {
          console.error(`[route-ready-sms] driver ${driver.id} failed:`, err);
        }
      })
  );
}
