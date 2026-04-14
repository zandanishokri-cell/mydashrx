import twilio from 'twilio';
import { db } from '../db/connection.js';
import { notificationLogs, organizations } from '../db/schema.js';
import { eq } from 'drizzle-orm';

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
