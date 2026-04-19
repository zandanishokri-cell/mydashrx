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

    // P-PERF3: run all independent analytics queries in parallel (7-serial → 2-parallel groups)
    const periodMs = toDate.getTime() - fromDate.getTime();
    const prevFrom = new Date(fromDate.getTime() - periodMs);
    const prevTo = new Date(fromDate.getTime() - 1);
    const prevBase = and(eq(stops.orgId, orgId), isNull(stops.deletedAt), gte(stops.createdAt, prevFrom), lte(stops.createdAt, prevTo), depotCondition);

    const [
      statusCounts,
      failureReasons,
      dailyRaw,
      driverStats,
      [prevCountRow],
      [deliveryTimeResult],
      [onTimeResult],
      depotStats,
    ] = await Promise.all([
      // Status breakdown
      db.select({ status: stops.status, cnt: sql<number>`count(*)::int` })
        .from(stops).where(base).groupBy(stops.status),
      // Failure reasons
      db.select({ reason: stops.failureReason, cnt: sql<number>`count(*)::int` })
        .from(stops).where(and(base, eq(stops.status, 'failed'))).groupBy(stops.failureReason),
      // Daily breakdown for charts
      db.select({ day: sql<string>`DATE(${stops.createdAt})::text`, status: stops.status, cnt: sql<number>`count(*)::int` })
        .from(stops).where(base).groupBy(sql`DATE(${stops.createdAt})`, stops.status),
      // Per-driver stats — exclude unassigned stops (routeId=null)
      db.select({
          driverId: routes.driverId,
          driverName: drivers.name,
          total: sql<number>`count(*)::int`,
          completed: sql<number>`sum(case when ${stops.status} = 'completed' then 1 else 0 end)::int`,
          failed: sql<number>`sum(case when ${stops.status} = 'failed' then 1 else 0 end)::int`,
        })
        .from(stops).innerJoin(routes, eq(stops.routeId, routes.id)).leftJoin(drivers, eq(routes.driverId, drivers.id))
        .where(base).groupBy(routes.driverId, drivers.name).orderBy(sql`count(*) DESC`),
      // Week-over-week previous period count
      db.select({ cnt: sql<number>`count(*)::int` }).from(stops).where(prevBase),
      // avgDeliveryTime: arrivedAt → completedAt in minutes
      db.select({ avgMin: sql<number>`avg(extract(epoch from (${stops.completedAt} - ${stops.arrivedAt})) / 60)` })
        .from(stops).where(and(base, eq(stops.status, 'completed'), sql`${stops.arrivedAt} is not null`, sql`${stops.completedAt} is not null`)),
      // onTimeRate: completed within delivery window
      db.select({
          onTime: sql<number>`sum(case when ${stops.completedAt} >= ${stops.windowStart} and ${stops.completedAt} <= ${stops.windowEnd} then 1 else 0 end)::int`,
          withWindow: sql<number>`sum(case when ${stops.windowStart} is not null and ${stops.windowEnd} is not null and ${stops.completedAt} is not null then 1 else 0 end)::int`,
        })
        .from(stops).where(and(base, eq(stops.status, 'completed'))),
      // Depot breakdown — INNER JOIN excludes unassigned stops to prevent "Unknown" phantom row
      db.select({
          depotId: plans.depotId,
          depotName: depots.name,
          total: sql<number>`count(*)::int`,
          completed: sql<number>`sum(case when ${stops.status} = 'completed' then 1 else 0 end)::int`,
        })
        .from(stops).innerJoin(routes, eq(stops.routeId, routes.id)).innerJoin(plans, eq(routes.planId, plans.id))
        .leftJoin(depots, eq(plans.depotId, depots.id)).where(base).groupBy(plans.depotId, depots.name).orderBy(sql`count(*) DESC`),
    ]);

    const byStatus: Record<string, number> = {};
    for (const r of statusCounts) byStatus[r.status] = r.cnt;

    const total = Object.values(byStatus).reduce((s, v) => s + v, 0);
    const completed = byStatus['completed'] ?? 0;
    const failed = byStatus['failed'] ?? 0;
    const rescheduled = byStatus['rescheduled'] ?? 0;
    const terminalTotal = completed + failed + rescheduled;
    const successRate = terminalTotal > 0 ? Math.round((completed / terminalTotal) * 1000) / 10 : 0;
    const failureRate = terminalTotal > 0 ? Math.round((failed / terminalTotal) * 1000) / 10 : 0;

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

    const driverStatsNamed = driverStats.map(d => ({ ...d, driverName: d.driverName ?? 'Unknown Driver' }));
    const activeDriverCount = driverStatsNamed.filter(d => d.total > 0).length;
    const routedTotal = driverStatsNamed.reduce((s, d) => s + d.total, 0);
    const avgPerDriver = activeDriverCount > 0 ? Math.round(routedTotal / activeDriverCount) : 0;

    const topPerformers = driverStatsNamed
      .filter(d => d.total > 0)
      .map(d => ({ ...d, completionRate: Math.round((d.completed / d.total) * 100) }))
      .sort((a, b) => b.completionRate - a.completionRate)
      .slice(0, 3);

    const prevTotal = prevCountRow?.cnt ?? 0;
    const weekOverWeekChange = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 1000) / 10 : null;

    const avgDeliveryTime = deliveryTimeResult?.avgMin != null ? Math.round(deliveryTimeResult.avgMin * 10) / 10 : null;
    const onTimeRate = (onTimeResult?.withWindow ?? 0) > 0
      ? Math.round(((onTimeResult!.onTime ?? 0) / onTimeResult!.withWindow) * 1000) / 10
      : null;

    const depotStatsResult = depotStats;

    return {
      summary: { total, completed, failed, successRate, failureRate, avgPerDriver, activeDriverCount, avgDeliveryTime, onTimeRate },
      byStatus,
      daily,
      failureReasons: failureReasons.map(r => ({ reason: r.reason ?? 'Unknown', count: r.cnt })),
      drivers: driverStatsNamed,
      depots: depotStatsResult,
      topPerformers,
      weekOverWeekChange,
    };
  });

  // P-COMP10: GET /delivery-performance — FADR + SLA + failure reason breakdown
  // FADR (First-Attempt Delivery Rate) = completed / (completed + failed) for terminal stops
  app.get('/delivery-performance', {
    preHandler: [requireOrgRole('dispatcher', 'pharmacy_admin', 'super_admin'), requireDepotAccess()],
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const { depotId, from, to } = req.query as { depotId?: string; from?: string; to?: string };

    const fromDate = from ? new Date(from + 'T00:00:00') : new Date(Date.now() - 30 * 86400000); // default 30d
    const toDate = to ? new Date(to + 'T23:59:59') : new Date();

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

    // Valid failure reason enum — enforce structured values in analytics output
    const VALID_FAILURE_REASONS = ['not_home', 'wrong_address', 'refused', 'damaged', 'id_required', 'weather', 'access_denied', 'other'] as const;

    const [
      terminalCounts,
      failureReasonRows,
      milestoneTimesRow,
      slaRows,
      driverFadrRows,
    ] = await Promise.all([
      // FADR numerator/denominator: completed vs failed terminal stops
      db.select({
          status: stops.status,
          cnt: sql<number>`count(*)::int`,
        })
        .from(stops).where(and(base, sql`${stops.status} in ('completed','failed','rescheduled')`))
        .groupBy(stops.status),

      // Failure reason breakdown — normalize unknown reasons to 'other'
      db.select({
          reason: sql<string>`coalesce(nullif(trim(${stops.failureReason}),''), 'other')`,
          cnt: sql<number>`count(*)::int`,
        })
        .from(stops).where(and(base, eq(stops.status, 'failed')))
        .groupBy(sql`coalesce(nullif(trim(${stops.failureReason}),''), 'other')`)
        .orderBy(sql`count(*) DESC`),

      // Milestone avg times: dispatch→arrive, arrive→complete (seconds)
      db.select({
          avgDispatchToArrive: sql<number>`avg(extract(epoch from (${stops.arrivedAt} - ${stops.createdAt})))`,
          avgArriveToComplete: sql<number>`avg(extract(epoch from (${stops.completedAt} - ${stops.arrivedAt})))`,
          avgTotalCycleTime: sql<number>`avg(extract(epoch from (${stops.completedAt} - ${stops.createdAt})))`,
        })
        .from(stops).where(and(
          base,
          eq(stops.status, 'completed'),
          sql`${stops.arrivedAt} is not null`,
          sql`${stops.completedAt} is not null`,
        )).then(r => r[0]),

      // SLA compliance: stops with delivery windows
      db.select({
          onTime: sql<number>`sum(case when ${stops.completedAt} <= ${stops.windowEnd} then 1 else 0 end)::int`,
          late: sql<number>`sum(case when ${stops.completedAt} > ${stops.windowEnd} then 1 else 0 end)::int`,
          total: sql<number>`count(*)::int`,
        })
        .from(stops).where(and(
          base,
          eq(stops.status, 'completed'),
          sql`${stops.windowEnd} is not null`,
          sql`${stops.completedAt} is not null`,
        )).then(r => r[0]),

      // Per-driver FADR
      db.select({
          driverId: routes.driverId,
          driverName: drivers.name,
          completed: sql<number>`sum(case when ${stops.status} = 'completed' then 1 else 0 end)::int`,
          failed: sql<number>`sum(case when ${stops.status} = 'failed' then 1 else 0 end)::int`,
          total: sql<number>`count(*)::int`,
        })
        .from(stops)
        .innerJoin(routes, eq(stops.routeId, routes.id))
        .leftJoin(drivers, eq(routes.driverId, drivers.id))
        .where(and(base, sql`${stops.status} in ('completed','failed','rescheduled')`))
        .groupBy(routes.driverId, drivers.name)
        .orderBy(sql`count(*) DESC`),
    ]);

    const byStatus: Record<string, number> = {};
    for (const r of terminalCounts) byStatus[r.status] = r.cnt;
    const completed = byStatus['completed'] ?? 0;
    const failed = byStatus['failed'] ?? 0;
    const rescheduled = byStatus['rescheduled'] ?? 0;
    const terminalTotal = completed + failed + rescheduled;
    const fadr = terminalTotal > 0 ? Math.round((completed / terminalTotal) * 1000) / 10 : null;
    const failureRate = terminalTotal > 0 ? Math.round(((failed + rescheduled) / terminalTotal) * 1000) / 10 : null;

    // Normalize failure reasons: collapse non-enum values to 'other'
    const reasonMap: Record<string, number> = {};
    for (const r of failureReasonRows) {
      const key = (VALID_FAILURE_REASONS as readonly string[]).includes(r.reason) ? r.reason : 'other';
      reasonMap[key] = (reasonMap[key] ?? 0) + r.cnt;
    }
    const failureBreakdown = Object.entries(reasonMap)
      .map(([reason, count]) => ({ reason, count, pct: failed > 0 ? Math.round((count / failed) * 1000) / 10 : 0 }))
      .sort((a, b) => b.count - a.count);

    const slaTotal = slaRows?.total ?? 0;
    const slaRate = slaTotal > 0 ? Math.round(((slaRows!.onTime ?? 0) / slaTotal) * 1000) / 10 : null;

    const driverFadr = (driverFadrRows ?? []).map(d => ({
      driverId: d.driverId,
      driverName: d.driverName ?? 'Unknown',
      completed: d.completed,
      failed: d.failed,
      total: d.total,
      fadr: (d.completed + d.failed) > 0
        ? Math.round((d.completed / (d.completed + d.failed)) * 1000) / 10
        : null,
    }));

    return {
      period: { from: fromDate.toISOString(), to: toDate.toISOString() },
      fadr,
      failureRate,
      terminalCounts: { completed, failed, rescheduled, total: terminalTotal },
      failureBreakdown,
      milestones: {
        avgDispatchToArriveSec: milestoneTimesRow?.avgDispatchToArrive != null ? Math.round(milestoneTimesRow.avgDispatchToArrive) : null,
        avgArriveToCompleteSec: milestoneTimesRow?.avgArriveToComplete != null ? Math.round(milestoneTimesRow.avgArriveToComplete) : null,
        avgTotalCycleTimeSec: milestoneTimesRow?.avgTotalCycleTime != null ? Math.round(milestoneTimesRow.avgTotalCycleTime) : null,
      },
      sla: { onTime: slaRows?.onTime ?? 0, late: slaRows?.late ?? 0, total: slaTotal, slaRate },
      driverFadr,
    };
  });
};
