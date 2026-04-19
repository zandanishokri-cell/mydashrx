import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { stops, routes, plans, depots, drivers } from '../db/schema.js';
import { eq, and, isNull, gte, lte, sql, inArray } from 'drizzle-orm';
import { requireOrgRole } from '../middleware/requireOrgRole.js';
import { requireDepotAccess } from '../middleware/requireDepotAccess.js';

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  // P-RBAC20: depot-scoped guard — dispatchers with depotId query param must have access to that depot
  app.get('/', {
    preHandler: [requireOrgRole('dispatcher', 'pharmacy_admin', 'super_admin'), requireDepotAccess()],
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const { depotId, from, to } = req.query as { depotId?: string; from?: string; to?: string };

    // Default: last 7 days
    // Use 'T00:00:00' (no Z) so date-only strings parse as local midnight, matching toDate which also uses local time
    const fromDate = from ? new Date(from + 'T00:00:00') : new Date(Date.now() - 7 * 86400000);
    const toDate = to ? new Date(to + 'T23:59:59') : new Date();

    // Depot filter: scope stops to routes belonging to the requested depot
    const depotCondition = depotId
      ? inArray(stops.routeId,
          db.select({ id: routes.id }).from(routes)
            .innerJoin(plans, and(eq(plans.id, routes.planId), eq(plans.depotId, depotId), eq(plans.orgId, orgId), isNull(plans.deletedAt)))
        )
      : undefined;

    const base = and(
      eq(stops.orgId, orgId),
      isNull(stops.deletedAt),
      gte(stops.createdAt, fromDate),
      lte(stops.createdAt, toDate),
      depotCondition,
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
    const rescheduled = byStatus['rescheduled'] ?? 0;
    // successRate/failureRate denominators only count terminal statuses (completed + failed + rescheduled)
    const terminalTotal = completed + failed + rescheduled;
    const successRate = terminalTotal > 0 ? Math.round((completed / terminalTotal) * 1000) / 10 : 0;
    const failureRate = terminalTotal > 0 ? Math.round((failed / terminalTotal) * 1000) / 10 : 0;

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
    const dayMap: Record<string, { date: string; total: number; completed: number; failed: number; rescheduled: number }> = {};
    for (const r of dailyRaw) {
      if (!dayMap[r.day]) dayMap[r.day] = { date: r.day, total: 0, completed: 0, failed: 0, rescheduled: 0 };
      dayMap[r.day].total += r.cnt;
      if (r.status === 'completed') dayMap[r.day].completed += r.cnt;
      if (r.status === 'failed') dayMap[r.day].failed += r.cnt;
      if (r.status === 'rescheduled') dayMap[r.day].rescheduled += r.cnt;
    }
    const daily = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));

    // Per-driver stats — exclude unassigned stops (routeId=null) from driver breakdown
    const driverStats = await db
      .select({
        driverId: routes.driverId,
        driverName: drivers.name,
        total: sql<number>`count(*)::int`,
        completed: sql<number>`sum(case when ${stops.status} = 'completed' then 1 else 0 end)::int`,
        failed: sql<number>`sum(case when ${stops.status} = 'failed' then 1 else 0 end)::int`,
      })
      .from(stops)
      .innerJoin(routes, eq(stops.routeId, routes.id))
      .leftJoin(drivers, eq(routes.driverId, drivers.id))
      .where(base)
      .groupBy(routes.driverId, drivers.name)
      .orderBy(sql`count(*) DESC`);

    const driverStatsNamed = driverStats.map(d => ({ ...d, driverName: d.driverName ?? 'Unknown Driver' }));
    const activeDriverCount = driverStatsNamed.filter(d => d.total > 0).length;
    // Use routed-stop total (from driverStats) so unassigned stops don't inflate avg
    const routedTotal = driverStatsNamed.reduce((s, d) => s + d.total, 0);
    const avgPerDriver = activeDriverCount > 0 ? Math.round(routedTotal / activeDriverCount) : 0;

    // Top performers: top 3 by completion rate (min 1 delivery)
    const topPerformers = driverStatsNamed
      .filter(d => d.total > 0)
      .map(d => ({ ...d, completionRate: Math.round((d.completed / d.total) * 100) }))
      .sort((a, b) => b.completionRate - a.completionRate)
      .slice(0, 3);

    // Week-over-week change
    const periodMs = toDate.getTime() - fromDate.getTime();
    const prevFrom = new Date(fromDate.getTime() - periodMs);
    const prevTo = new Date(fromDate.getTime() - 1);
    const prevBase = and(eq(stops.orgId, orgId), isNull(stops.deletedAt), gte(stops.createdAt, prevFrom), lte(stops.createdAt, prevTo), depotCondition);
    const [prevCount] = await db.select({ cnt: sql<number>`count(*)::int` }).from(stops).where(prevBase);
    const prevTotal = prevCount?.cnt ?? 0;
    const weekOverWeekChange = prevTotal > 0
      ? Math.round(((total - prevTotal) / prevTotal) * 1000) / 10
      : null;

    // avgDeliveryTime: arrivedAt → completedAt in minutes (arrivedAt exists in schema)
    const [deliveryTimeResult] = await db
      .select({
        avgMin: sql<number>`avg(extract(epoch from (${stops.completedAt} - ${stops.arrivedAt})) / 60)`,
      })
      .from(stops)
      .where(and(base, eq(stops.status, 'completed'), sql`${stops.arrivedAt} is not null`, sql`${stops.completedAt} is not null`));
    const avgDeliveryTime = deliveryTimeResult?.avgMin != null
      ? Math.round(deliveryTimeResult.avgMin * 10) / 10
      : null;

    // onTimeRate: completed within the delivery window (not just before windowEnd)
    const [onTimeResult] = await db
      .select({
        onTime: sql<number>`sum(case when ${stops.completedAt} >= ${stops.windowStart} and ${stops.completedAt} <= ${stops.windowEnd} then 1 else 0 end)::int`,
        withWindow: sql<number>`sum(case when ${stops.windowStart} is not null and ${stops.windowEnd} is not null and ${stops.completedAt} is not null then 1 else 0 end)::int`,
      })
      .from(stops)
      .where(and(base, eq(stops.status, 'completed')));
    const onTimeRate = (onTimeResult?.withWindow ?? 0) > 0
      ? Math.round(((onTimeResult!.onTime ?? 0) / onTimeResult!.withWindow) * 1000) / 10
      : null;

    // Depot breakdown — INNER JOIN excludes unassigned stops (routeId=null) to prevent "Unknown" phantom row
    const depotStats = await db
      .select({
        depotId: plans.depotId,
        depotName: depots.name,
        total: sql<number>`count(*)::int`,
        completed: sql<number>`sum(case when ${stops.status} = 'completed' then 1 else 0 end)::int`,
      })
      .from(stops)
      .innerJoin(routes, eq(stops.routeId, routes.id))
      .innerJoin(plans, eq(routes.planId, plans.id))
      .leftJoin(depots, eq(plans.depotId, depots.id))
      .where(base)
      .groupBy(plans.depotId, depots.name)
      .orderBy(sql`count(*) DESC`);

    return {
      summary: { total, completed, failed, successRate, failureRate, avgPerDriver, activeDriverCount, avgDeliveryTime, onTimeRate },
      byStatus,
      daily,
      failureReasons: failureReasons.map(r => ({ reason: r.reason ?? 'Unknown', count: r.cnt })),
      drivers: driverStatsNamed,
      depots: depotStats,
      topPerformers,
      weekOverWeekChange,
    };
  });
};
