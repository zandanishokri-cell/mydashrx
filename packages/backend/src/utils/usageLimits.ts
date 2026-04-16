import { db } from '../db/connection.js';
import { organizations, stops, drivers } from '../db/schema.js';
import { eq, and, isNull, gte, count } from 'drizzle-orm';

const PLAN_LIMITS: Record<string, { stopLimit: number | null; driverLimit: number | null }> = {
  starter:    { stopLimit: 100,  driverLimit: 2 },
  growth:     { stopLimit: 500,  driverLimit: 10 },
  pro:        { stopLimit: 2000, driverLimit: 50 },
  enterprise: { stopLimit: null, driverLimit: null },
};

interface LimitResult {
  allowed: boolean;
  current: number;
  limit: number | null;
  wouldExceedBy?: number;
}

export async function checkStopLimit(orgId: string, addingCount = 1): Promise<LimitResult> {
  const [org] = await db
    .select({ billingPlan: organizations.billingPlan, timezone: organizations.timezone })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!org) return { allowed: false, current: 0, limit: 0 };

  const plan = PLAN_LIMITS[org.billingPlan] ?? PLAN_LIMITS.starter;
  if (plan.stopLimit === null) return { allowed: true, current: 0, limit: null };

  // Compute local month start using org timezone — prevents UTC midnight bypass at month boundary
  const tz = org.timezone ?? 'America/New_York';
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' });
  const parts = fmt.formatToParts(now);
  const yr = parts.find(p => p.type === 'year')!.value;
  const mo = parts.find(p => p.type === 'month')!.value;
  // Use noon on the 1st to safely get the timezone offset (avoids DST boundary edge cases)
  const noonOn1st = new Date(`${yr}-${mo}-01T12:00:00Z`);
  const localNoon = new Date(noonOn1st.toLocaleString('en-US', { timeZone: tz }));
  const offsetMs = noonOn1st.getTime() - localNoon.getTime();
  const monthStart = new Date(new Date(`${yr}-${mo}-01T00:00:00Z`).getTime() + offsetMs);

  const [row] = await db
    .select({ n: count() })
    .from(stops)
    .where(and(eq(stops.orgId, orgId), isNull(stops.deletedAt), gte(stops.createdAt, monthStart)));

  const current = Number(row?.n ?? 0);
  const wouldExceedBy = Math.max(0, current + addingCount - plan.stopLimit);
  return {
    allowed: current + addingCount <= plan.stopLimit,
    current,
    limit: plan.stopLimit,
    wouldExceedBy: wouldExceedBy > 0 ? wouldExceedBy : undefined,
  };
}

export async function checkDriverLimit(orgId: string): Promise<LimitResult> {
  const [org] = await db
    .select({ billingPlan: organizations.billingPlan })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!org) return { allowed: false, current: 0, limit: 0 };

  const plan = PLAN_LIMITS[org.billingPlan] ?? PLAN_LIMITS.starter;
  if (plan.driverLimit === null) return { allowed: true, current: 0, limit: null };

  const [row] = await db
    .select({ n: count() })
    .from(drivers)
    .where(and(eq(drivers.orgId, orgId), isNull(drivers.deletedAt)));

  const current = Number(row?.n ?? 0);
  return { allowed: current < plan.driverLimit, current, limit: plan.driverLimit };
}
