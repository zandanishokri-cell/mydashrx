import twilio from 'twilio';
import { db } from '../db/connection.js';
import { notificationLogs, organizations, users } from '../db/schema.js';
import { eq, and, isNull, inArray, or } from 'drizzle-orm';

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
  eta_updated: (d) =>
    `Your delivery ETA updated to ~${d.etaMin} min. Track: ${d.trackingUrl}`,
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
    status?: string;
  },
  event: string,
  extra: Record<string, string> = {},
): Promise<void> {
  const template = SMS_TEMPLATES[event];
  if (!template || !stop.recipientPhone) return;

  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, stop.orgId))
    .limit(1);

  const trackingUrl = `${process.env.DASHBOARD_URL ?? 'https://app.mydashrx.com'}/track/${String(stop.trackingToken)}`;

  const body = template({
    pharmacyName: org?.name ?? 'Your Pharmacy',
    pharmacyPhone: 'your pharmacy',
    driverName: 'Your driver',
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
      event,
      channel: 'sms',
      recipient: stop.recipientPhone,
      status: 'sent',
      externalId: msg.sid,
    });
  } catch (err) {
    await db.insert(notificationLogs).values({
      stopId: stop.id,
      event,
      channel: 'sms',
      recipient: stop.recipientPhone,
      status: 'failed',
    });
    console.error('SMS notification failed:', err);
  }
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
        html,
      }),
    })
  ));
}
