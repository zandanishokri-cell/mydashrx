import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { stops, routes, plans, drivers } from '../db/schema.js';
import { eq, and, isNull, isNotNull, gte, lte, sql, inArray, desc } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  // GET /orgs/:orgId/dashboard/summary
  app.get('/summary', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // Today's plans → routes → stops in a single joined query
    const todayPlans = await db
      .select({ id: plans.id })
      .from(plans)
      .where(and(
        eq(plans.orgId, orgId),
        isNull(plans.deletedAt),
        eq(plans.date, todayStart.toISOString().split('T')[0]),
      ));

    const planIds = todayPlans.map(p => p.id);

    let stopsToday = 0;
    let completedToday = 0;
    let inProgressToday = 0;

    if (planIds.length > 0) {
      const todayRoutes = await db
        .select({ id: routes.id })
        .from(routes)
        .where(and(
          inArray(routes.planId, planIds),
          isNull(routes.deletedAt),
        ));

      const routeIds = todayRoutes.map(r => r.id);

      if (routeIds.length > 0) {
        const stopCounts = await db
          .select({
            status: stops.status,
            cnt: sql<number>`count(*)::int`,
          })
          .from(stops)
          .where(and(
            eq(stops.orgId, orgId),
            isNull(stops.deletedAt),
            inArray(stops.routeId, routeIds),
          ))
          .groupBy(stops.status);

        for (const row of stopCounts) {
          stopsToday += row.cnt;
          if (row.status === 'completed') completedToday = row.cnt;
          if (row.status === 'en_route' || row.status === 'arrived') inProgressToday += row.cnt;
        }
      }
    }

    // Active drivers: status = 'on_route', not deleted
    const [activeRow] = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(drivers)
      .where(and(
        eq(drivers.orgId, orgId),
        isNull(drivers.deletedAt),
        eq(drivers.status, 'on_route'),
      ));

    return {
      stopsToday,
      completedToday,
      inProgressToday,
      activeDrivers: activeRow?.cnt ?? 0,
    };
  });

  // GET /orgs/:orgId/dashboard/drivers — fleet status for Command Center
  app.get('/drivers', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const today = new Date().toISOString().split('T')[0];

    const allDrivers = await db
      .select({
        id: drivers.id,
        name: drivers.name,
        status: drivers.status,
        vehicleType: drivers.vehicleType,
        currentLat: drivers.currentLat,
        currentLng: drivers.currentLng,
        lastPingAt: drivers.lastPingAt,
      })
      .from(drivers)
      .where(and(eq(drivers.orgId, orgId), isNull(drivers.deletedAt)));

    if (allDrivers.length === 0) return { drivers: [] };

    // Today's plans → routes → stop counts
    const todayPlans = await db
      .select({ id: plans.id })
      .from(plans)
      .where(and(eq(plans.orgId, orgId), isNull(plans.deletedAt), eq(plans.date, today)));

    const planIds = todayPlans.map(p => p.id);
    const driverRouteMap = new Map<string, { routeId: string; routeStatus: string; totalStops: number; completedStops: number }>();

    if (planIds.length > 0) {
      const todayRoutes = await db
        .select({ id: routes.id, driverId: routes.driverId, status: routes.status })
        .from(routes)
        .where(and(inArray(routes.planId, planIds), isNull(routes.deletedAt), isNotNull(routes.driverId)));

      const routeIds = todayRoutes.map(r => r.id);

      if (routeIds.length > 0) {
        const stopCounts = await db
          .select({ routeId: stops.routeId, status: stops.status, cnt: sql<number>`count(*)::int` })
          .from(stops)
          .where(and(eq(stops.orgId, orgId), isNull(stops.deletedAt), inArray(stops.routeId, routeIds)))
          .groupBy(stops.routeId, stops.status);

        const routeTotals = new Map<string, { total: number; completed: number }>();
        for (const row of stopCounts) {
          const cur = routeTotals.get(row.routeId) ?? { total: 0, completed: 0 };
          cur.total += row.cnt;
          if (row.status === 'completed') cur.completed += row.cnt;
          routeTotals.set(row.routeId, cur);
        }

        for (const route of todayRoutes) {
          if (!route.driverId) continue;
          const counts = routeTotals.get(route.id) ?? { total: 0, completed: 0 };
          driverRouteMap.set(route.driverId, {
            routeId: route.id,
            routeStatus: route.status,
            totalStops: counts.total,
            completedStops: counts.completed,
          });
        }
      }
    }

    return {
      drivers: allDrivers.map(d => ({
        ...d,
        lastPingAt: d.lastPingAt?.toISOString() ?? null,
        ...(driverRouteMap.get(d.id) ?? { routeId: null, routeStatus: null, totalStops: 0, completedStops: 0 }),
      })),
    };
  });

  // GET /orgs/:orgId/dashboard/today — single aggregate: plans + routes + stops
  app.get('/today', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const q = req.query as { date?: string; depotId?: string };
    const today = q.date ?? new Date().toISOString().split('T')[0];

    const planRows = await db.select({
      id: plans.id,
      date: plans.date,
      status: plans.status,
      depotId: plans.depotId,
    }).from(plans).where(and(
      eq(plans.orgId, orgId),
      isNull(plans.deletedAt),
      eq(plans.date, today),
      q.depotId ? eq(plans.depotId, q.depotId) : undefined,
    )).orderBy(desc(plans.createdAt));

    if (planRows.length === 0) return { plans: [] };

    const planIds = planRows.map(p => p.id);

    const routeRows = await db.select({
      id: routes.id,
      planId: routes.planId,
      driverId: routes.driverId,
      status: routes.status,
      stopOrder: routes.stopOrder,
      estimatedDuration: routes.estimatedDuration,
    }).from(routes).where(and(inArray(routes.planId, planIds), isNull(routes.deletedAt)));

    type StopSlim = { id: string; status: string; routeId: string };
    type RouteWithStops = { id: string; planId: string; driverId: string | null; status: string; stopOrder: unknown; estimatedDuration: number | null; stops: StopSlim[] };
    type PlanWithRoutes = { id: string; date: string; status: string; depotId: string; routes: RouteWithStops[] };

    const routeMap = new Map<string, RouteWithStops>(
      routeRows.map(r => [r.id, { ...r, stops: [] }])
    );
    const planMap = new Map<string, PlanWithRoutes>(
      planRows.map(p => [p.id, { ...p, routes: [] }])
    );
    for (const r of routeRows) planMap.get(r.planId)?.routes.push(routeMap.get(r.id)!);

    const routeIds = routeRows.map(r => r.id);
    if (routeIds.length > 0) {
      const stopRows = await db.select({
        id: stops.id,
        status: stops.status,
        routeId: stops.routeId,
      }).from(stops).where(and(
        eq(stops.orgId, orgId),
        isNull(stops.deletedAt),
        inArray(stops.routeId, routeIds),
      ));
      for (const s of stopRows) routeMap.get(s.routeId)?.stops.push(s);
    }

    return { plans: [...planMap.values()] };
  });
};
