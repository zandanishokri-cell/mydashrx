/**
 * P-DEL21: Subdomain warm-up volume caps + bounce rate circuit breaker
 * Gmail/Outlook Nov 2025: hard REJECTION at 2% bounce rate for cold sending domains.
 * WARMUP_SCHEDULE: progressive daily limits to build sender reputation safely.
 * Hard stop at 1.8% bounce rate — throw + audit log before REJECTION threshold.
 */
import { db } from '../db/connection.js';
import { sql, eq, and, gte } from 'drizzle-orm';
import { emailDailyCounts } from '../db/schema.js';

// Day ranges → daily send cap
export const WARMUP_SCHEDULE: [number, number][] = [
  [7,   50],   // days 1-7
  [14,  100],  // days 8-14
  [21,  250],  // days 15-21
  [28,  500],  // days 22-28
  [Infinity, 1000], // days 29+
];

export async function getDaysSinceFirstSend(subdomain: string): Promise<number> {
  const [row] = await db
    .select({ firstDate: sql<string>`min(date)::text` })
    .from(emailDailyCounts)
    .where(eq(emailDailyCounts.subdomain, subdomain));
  if (!row?.firstDate) return 0;
  const msPerDay = 86_400_000;
  return Math.floor((Date.now() - new Date(row.firstDate).getTime()) / msPerDay);
}

export function getDailyLimitFromDays(days: number): number {
  for (const [ceiling, limit] of WARMUP_SCHEDULE) {
    if (days < ceiling) return limit;
  }
  return WARMUP_SCHEDULE[WARMUP_SCHEDULE.length - 1][1];
}

export async function getDailyLimit(subdomain: string): Promise<number> {
  const days = await getDaysSinceFirstSend(subdomain);
  return getDailyLimitFromDays(days);
}

/** Throws if daily cap reached. Otherwise upserts today's count +1. */
export async function checkAndIncrementSend(subdomain: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

  // Upsert row for today — returns current sent count BEFORE increment
  await db.execute(sql`
    INSERT INTO email_daily_counts (subdomain, date, sent, bounced)
    VALUES (${subdomain}, ${today}::date, 0, 0)
    ON CONFLICT (subdomain, date) DO NOTHING
  `);

  const [row] = await db
    .select({ sent: emailDailyCounts.sent })
    .from(emailDailyCounts)
    .where(and(eq(emailDailyCounts.subdomain, subdomain), eq(emailDailyCounts.date, today as any)));

  const limit = await getDailyLimit(subdomain);
  if ((row?.sent ?? 0) >= limit) {
    throw new Error(`email_warmup_daily_limit_exceeded: subdomain=${subdomain} sent=${row?.sent} limit=${limit}`);
  }

  await db.execute(sql`
    UPDATE email_daily_counts SET sent = sent + 1
    WHERE subdomain = ${subdomain} AND date = ${today}::date
  `);
}

/** Increments bounce count for today's subdomain row (call from resend webhook). */
export async function recordBounce(subdomain: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await db.execute(sql`
    INSERT INTO email_daily_counts (subdomain, date, sent, bounced)
    VALUES (${subdomain}, ${today}::date, 0, 1)
    ON CONFLICT (subdomain, date) DO UPDATE SET bounced = email_daily_counts.bounced + 1
  `);
}

/**
 * Rolling 24hr bounce rate for a subdomain.
 * Throws + logs audit event if >= 1.8% (circuit breaker before Gmail 2% hard rejection).
 */
export async function getOutreachBounceRate(subdomain: string): Promise<number> {
  const since = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  const [agg] = await db
    .select({
      totalSent:    sql<number>`coalesce(sum(sent), 0)::int`,
      totalBounced: sql<number>`coalesce(sum(bounced), 0)::int`,
    })
    .from(emailDailyCounts)
    .where(and(
      eq(emailDailyCounts.subdomain, subdomain),
      gte(emailDailyCounts.date, since as any),
    ));

  const { totalSent, totalBounced } = agg ?? { totalSent: 0, totalBounced: 0 };
  if (totalSent === 0) return 0;

  const rate = totalBounced / totalSent;

  if (rate >= 0.018) {
    // Circuit breaker: log + throw before Gmail's 2% hard rejection threshold
    // Use raw SQL to avoid audit_logs NOT NULL constraint on orgId/resource (system-level event)
    db.execute(sql`
      INSERT INTO audit_logs (id, org_id, user_id, action, resource, metadata, created_at)
      VALUES (
        gen_random_uuid(),
        '00000000-0000-0000-0000-000000000000',
        NULL,
        'email_bounce_limit_exceeded',
        'email_warmup',
        ${JSON.stringify({ subdomain, totalSent, totalBounced, rate: (rate * 100).toFixed(2) + '%' })}::jsonb,
        now()
      )
    `).catch(() => {}); // fire-and-forget, non-blocking
    throw new Error(`email_bounce_limit_exceeded: subdomain=${subdomain} rate=${(rate * 100).toFixed(2)}% (>=1.8% circuit breaker)`);
  }

  return rate;
}
