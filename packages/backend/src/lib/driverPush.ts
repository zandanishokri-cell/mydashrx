/**
 * P-DEL16: Web push notifications for drivers — mid-route change alerts
 * VAPID-based push via web-push. Subscriptions have 90-day TTL.
 * Auto-deletes on 410 Gone (subscription expired on push service side).
 */
import webPush from 'web-push';
import { db } from '../db/connection.js';
import { sql } from 'drizzle-orm';

let vapidConfigured = false;

function ensureVapid() {
  if (vapidConfigured) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const sub = process.env.VAPID_SUBJECT ?? 'mailto:support@mydashrx.com';
  if (!pub || !priv) {
    console.warn('P-DEL16: VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY not set — web push disabled');
    return;
  }
  webPush.setVapidDetails(sub, pub, priv);
  vapidConfigured = true;
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  data?: Record<string, unknown>;
}

/**
 * Send a web push notification to all active subscriptions for a user.
 * Silently skips if VAPID keys not configured.
 * Auto-removes expired subscriptions (410 Gone).
 */
export async function sendDriverPush(userId: string, payload: PushPayload): Promise<void> {
  ensureVapid();
  if (!vapidConfigured) return;

  let rows: Array<{ id: string; endpoint: string; p256dh: string; auth: string }>;
  try {
    rows = [...await db.execute(sql`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ${userId} AND expires_at > now()`)] as typeof rows;
  } catch { return; }

  if (!rows.length) return;

  const message = JSON.stringify(payload);
  const toDelete: string[] = [];

  await Promise.all(rows.map(async (sub) => {
    try {
      await webPush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        message,
        { TTL: 3600 },
      );
      // Update last_used_at
      db.execute(sql`UPDATE push_subscriptions SET last_used_at = now() WHERE id = ${sub.id}`).catch(() => {});
    } catch (err: unknown) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 410 || status === 404) {
        toDelete.push(sub.id); // subscription expired on push service side
      }
    }
  }));

  if (toDelete.length) {
    db.execute(sql`DELETE FROM push_subscriptions WHERE id = ANY(${toDelete}::uuid[])`).catch(() => {});
  }
}
