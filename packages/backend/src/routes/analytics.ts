import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { stops, routes, plans, depots, drivers } from '../db/schema.js';
import { eq, and, isNull, gte, lte, sql, count } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const { depotId, from, to } = req.query as { depotId?: string; from?: string; to?: string };

    // Default: last 7 days
    const fromDate = from ? new Date(from) : new Date(Date.now() - 7 * 86400000);
    const toDate = to ? new Date(to + 'T23:59:59') : new Date();

    const base = and(
      eq(stops.orgId, orgId),
      isNull(stops.deletedAt),
      gte(stops.createdAt, fromDate),
      lte(stops.createdAt, toDate),
    );

    // Status breakdown
    const statusCounts = await db
      .select({ status: stops.status, cnt: sql<number>`count(*)::int` })
      .from(stops)
      .where(base)
      .groupBy(stops.status);

    const byStatus: Record<string, number> = {};
    for (const r of statusCounts) byStatus[r.status] = r.cnt;

    const total = Object.values(byStatus).reduce((s, v) => s + v, 0);
    const completed = byStatus['completed'] ?? 0;
    const failed = byStatus['failed'] ?? 0;
    const successRate = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;
    const failureRate = total > 0 ? Math.round((failed / total) * 1000) / 10 : 0;

    // Failure reasons
    const failureReasons = await db
      .select({ reason: stops.failureReason, cnt: sql<number>`count(*)::int` })
      .from(stops)
      .where(and(base, eq(stops.status, 'failed')))
      .groupBy(stops.failureReason);

    // Daily breakdown for charts
    const dailyRaw = await db
      .select({
        day: sql<string>`DATE(${stops.createdAt})::text`,
        status: stops.status,
        cnt: sql<number>`count(*)::int`,
      })
      .from(stops)
      .where(base)
      .groupBy(sql`DATE(${stops.createdAt})`, stops.status);

    // Pivot daily data
    const dayMap: Record<string, { date: string; total: number; completed: number; failed: number }> = {};
    for (const r of dailyRaw) {
      if (!dayMap[r.day]) dayMap[r.day] = { date: r.day, total: 0, completed: 0, failed: 0 };
      dayMap[r.day].total += r.cnt;
      if (r.status === 'completed') dayMap[r.day].completed += r.cnt;
      if (r.status === 'failed') dayMap[r.day].failed += r.cnt;
    }
    const daily = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));

    // Per-driver stats
    const driverStats = await db
      .select({
        driverId: routes.driverId,
        driverName: drivers.name,
        total: sql<number>`count(*)::int`,
        completed: sql<number>`sum(case when ${stops.status} = 'completed' then 1 else 0 end)::int`,
        failed: sql<number>`sum(case when ${stops.status} = 'failed' then 1 else 0 end)::int`,
      })
      .from(stops)
      .leftJoin(routes, eq(stops.routeId, routes.id))
      .leftJoin(drivers, eq(routes.driverId, drivers.id))
      .where(base)
      .groupBy(routes.driverId, drivers.name)
      .orderBy(sql`count(*) DESC`)
      .limit(20);

    const activeDriverCount = driverStats.filter(d => d.total > 0).length;
    const avgPerDriver = activeDriverCount > 0 ? Math.round(total / activeDriverCount) : 0;

    // Depot breakdown
    const depotStats = await db
      .select({
        depotId: plans.depotId,
        depotName: depots.name,
        total: sql<number>`count(*)::int`,
        completed: sql<number>`sum(case when ${stops.status} = 'completed' then 1 else 0 end)::int`,
      })
      .from(stops)
      .leftJoin(routes, eq(stops.routeId, routes.id))
      .leftJoin(plans, eq(routes.planId, plans.id))
      .leftJoin(depots, eq(plans.depotId, depots.id))
      .where(base)
      .groupBy(plans.depotId, depots.name)
      .orderBy(sql`count(*) DESC`);

    return {
      summary: { total, completed, failed, successRate, failureRate, avgPerDriver, activeDriverCount },
      byStatus,
      daily,
      failureReasons: failureReasons.map(r => ({ reason: r.reason ?? 'Unknown', count: r.cnt })),
      drivers: driverStats,
      depots: depotStats,
    };
  });
};
