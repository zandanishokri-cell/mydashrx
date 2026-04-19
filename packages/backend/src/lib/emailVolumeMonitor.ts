/**
 * P-DEL28: Email volume monitor — alert when daily send volume approaches dedicated IP threshold.
 * Auth emails and outreach emails use separate Resend API keys to prevent cold-outreach spam
 * complaints from contaminating the auth stream sender reputation.
 * Alert at 400 emails/day (80% of 500 dedicated IP warm-up threshold).
 */
import { db } from '../db/connection.js';
import { emailDailyCounts, adminAuditLogs } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';

const ALERT_THRESHOLD = 400; // 80% of 500 dedicated IP threshold

export async function checkDailyVolume(type: 'auth' | 'outreach'): Promise<{ sent: number; alert: boolean }> {
  const today = new Date().toISOString().slice(0, 10);

  const [row] = await db
    .select({ sent: emailDailyCounts.sent })
    .from(emailDailyCounts)
    .where(and(eq(emailDailyCounts.subdomain, type), eq(emailDailyCounts.date, today as any)));

  const sent = row?.sent ?? 0;
  const alert = sent >= ALERT_THRESHOLD;

  if (alert) {
    db.insert(adminAuditLogs).values({
      actorId: null,
      action: 'email_volume_alert',
      targetType: 'email_stream',
      targetId: type,
      metadata: { type, sent, threshold: ALERT_THRESHOLD, date: today },
    } as any).catch(() => {});
  }

  return { sent, alert };
}
