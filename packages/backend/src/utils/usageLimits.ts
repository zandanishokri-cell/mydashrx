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
    .select({ billingPlan: organizations.billingPlan })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!org) return { allowed: false, current: 0, limit: 0 };

  const plan = PLAN_LIMITS[org.billingPlan] ?? PLAN_LIMITS.starter;
  if (plan.stopLimit === null) return { allowed: true, current: 0, limit: null };

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

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
