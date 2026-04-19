import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { stops, routes, plans, drivers } from '../db/schema.js';
import { eq, and, isNull, isNotNull, sql, inArray, desc } from 'drizzle-orm';
import { requireOrgRole } from '../middleware/requireOrgRole.js';
import { todayInTz } from '../utils/date.js';
import { getDashboardDrivers } from '../db/preparedStatements.js'; // P-PERF10
import { dashboardCombinedKey, getDashboardCached, setDashboardCached } from '../lib/responseCache.js'; // P-PERF14

// P-PERF14: extracted compute function — shared by direct calls and stale-while-revalidate background refresh
type StopCountRow = { status: string; cnt: number };
type ActiveRow = { cnt: number };
type RouteCountRow = { driver_id: string; route_id: string; route_status: string; total_stops: number; completed_stops: number };
type PlanRow = { id: string; date: string; status: string; depot_id: string };
type JoinRow = { route_id: string; plan_id: string; driver_id: string | null; route_status: string; stop_order: unknown; estimated_duration: number | null; stop_id: string | null; stop_status: string | null; stop_route_id: string | null };
type StopSlim = { id: string; status: string; routeId: string | null };
type RouteWithStops = { id: string; planId: string; driverId: string | null; status: string; stopOrder: unknown; estimatedDuration: number | null; stops: StopSlim[] };
type PlanWithRoutes = { id: string; date: string; status: string; depotId: string; routes: RouteWithStops[] };

async function computeCombined(
  orgId: string,
  q: { depotId?: string; date?: string; fields?: string },
  today: string,
  includeGps: boolean,
) {
  const depotSql = q.depotId ? sql`AND p.depot_id = ${q.depotId}` : sql``;

  const [stopCountRows, [activeRow], allDrivers, routeCountRows, planRows, joinRows] = await Promise.all([
    db.execute(sql`
      SELECT s.status, COUNT(*)::int AS cnt
      FROM stops s
      JOIN routes r ON r.id = s.route_id AND r.deleted_at IS NULL
      JOIN plans p  ON p.id = r.plan_id AND p.deleted_at IS NULL
        AND p.org_id = ${orgId} AND p.date = ${today} ${depotSql}
      WHERE s.org_id = ${orgId} AND s.deleted_at IS NULL
      GROUP BY s.status
    `) as unknown as StopCountRow[],
    db.select({ cnt: sql<number>`count(*)::int` })
      .from(drivers).where(and(eq(drivers.orgId, orgId), isNull(drivers.deletedAt), eq(drivers.status, 'on_route'))),
    db.select({ id: drivers.id, name: drivers.name, status: drivers.status, vehicleType: drivers.vehicleType, currentLat: drivers.currentLat, currentLng: drivers.currentLng, lastPingAt: drivers.lastPingAt })
      .from(drivers).where(and(eq(drivers.orgId, orgId), isNull(drivers.deletedAt))),
    db.execute(sql`
      SELECT r.driver_id, r.id AS route_id, r.status AS route_status,
        COUNT(s.id)::int AS total_stops,
        COUNT(s.id) FILTER (WHERE s.status = 'completed')::int AS completed_stops
      FROM routes r
      JOIN plans p ON p.id = r.plan_id AND p.org_id = ${orgId} AND p.deleted_at IS NULL AND p.date = ${today} ${depotSql}
      LEFT JOIN stops s ON s.route_id = r.id AND s.deleted_at IS NULL AND s.org_id = ${orgId}
      WHERE r.deleted_at IS NULL AND r.driver_id IS NOT NULL
      GROUP BY r.driver_id, r.id, r.status
    `) as unknown as RouteCountRow[],
    db.execute(sql`
      SELECT id, date, status, depot_id FROM plans
      WHERE org_id = ${orgId} AND deleted_at IS NULL AND date = ${today} ${depotSql}
      ORDER BY created_at DESC
    `) as unknown as PlanRow[],
    db.execute(sql`
      SELECT r.id AS route_id, r.plan_id, r.driver_id, r.status AS route_status,
        r.stop_order, r.estimated_duration,
        s.id AS stop_id, s.status AS stop_status, s.route_id AS stop_route_id
      FROM routes r
      LEFT JOIN stops s ON s.route_id = r.id AND s.deleted_at IS NULL AND s.org_id = ${orgId}
      JOIN plans p ON p.id = r.plan_id AND p.org_id = ${orgId} AND p.deleted_at IS NULL AND p.date = ${today} ${depotSql}
      WHERE r.deleted_at IS NULL
    `) as unknown as JoinRow[],
  ]);

  let stopsToday = 0, completedToday = 0, inProgressToday = 0;
  for (const row of stopCountRows) {
    stopsToday += row.cnt;
    if (row.status === 'completed') completedToday = row.cnt;
    if (row.status === 'en_route' || row.status === 'arrived') inProgressToday += row.cnt;
  }
  const summary = { stopsToday, completedToday, inProgressToday, activeDrivers: activeRow?.cnt ?? 0 };

  const driverRouteMap = new Map(
    routeCountRows.map(r => [r.driver_id, { routeId: r.route_id, routeStatus: r.route_status, totalStops: r.total_stops, completedStops: r.completed_stops }])
  );
  const driversOut = allDrivers.map(d => {
    const base = { id: d.id, name: d.name, status: d.status, vehicleType: d.vehicleType, ...(driverRouteMap.get(d.id) ?? { routeId: null, routeStatus: null, totalStops: 0, completedStops: 0 }) };
    if (includeGps) return { ...base, currentLat: d.currentLat, currentLng: d.currentLng, lastPingAt: d.lastPingAt?.toISOString() ?? null };
    return base;
  });

  const routeMap = new Map<string, RouteWithStops>();
  const planMap = new Map<string, PlanWithRoutes>(planRows.map(p => [p.id, { id: p.id, date: p.date, status: p.status, depotId: p.depot_id, routes: [] }]));
  for (const row of joinRows) {
    if (!routeMap.has(row.route_id)) {
      const route: RouteWithStops = { id: row.route_id, planId: row.plan_id, driverId: row.driver_id, status: row.route_status, stopOrder: row.stop_order, estimatedDuration: row.estimated_duration, stops: [] };
      routeMap.set(row.route_id, route);
      planMap.get(row.plan_id)?.routes.push(route);
    }
    if (row.stop_id) routeMap.get(row.route_id)?.stops.push({ id: row.stop_id, status: row.stop_status!, routeId: row.stop_route_id });
  }

  return { summary, drivers: driversOut, plans: [...planMap.values()] };
}

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  // GET /orgs/:orgId/dashboard/summary
  // P-PERF6: Single SQL JOIN replaces 3-serial-waterfall (plans→routes→stops).
  // Cuts ~67% of DB round-trips on every dashboard poll.
  app.get('/summary', {
    preHandler: requireOrgRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const q = req.query as { depotId?: string };
    const today = todayInTz();

    // Single joined query: plans → routes → stops + drivers count in parallel
    type StopCountRow = { status: string; cnt: number };
    type ActiveRow = { cnt: number };

    const [stopCountRows, [activeRow]] = await Promise.all([
      db.execute(sql`
        SELECT s.status, COUNT(*)::int AS cnt
        FROM stops s
        JOIN routes r ON r.id = s.route_id AND r.deleted_at IS NULL
        JOIN plans p  ON p.id = r.plan_id  AND p.deleted_at IS NULL
          AND p.org_id = ${orgId}
          AND p.date   = ${today}
          ${q.depotId ? sql`AND p.depot_id = ${q.depotId}` : sql``}
        WHERE s.org_id     = ${orgId}
          AND s.deleted_at IS NULL
        GROUP BY s.status
      `) as unknown as StopCountRow[],
      db.select({ cnt: sql<number>`count(*)::int` })
        .from(drivers)
        .where(and(eq(drivers.orgId, orgId), isNull(drivers.deletedAt), eq(drivers.status, 'on_route'))),
    ]);

    let stopsToday = 0, completedToday = 0, inProgressToday = 0;
    for (const row of stopCountRows) {
      stopsToday += row.cnt;
      if (row.status === 'completed') completedToday = row.cnt;
      if (row.status === 'en_route' || row.status === 'arrived') inProgressToday += row.cnt;
    }

    return {
      stopsToday,
      completedToday,
      inProgressToday,
      activeDrivers: activeRow?.cnt ?? 0,
    };
  });

  // GET /orgs/:orgId/dashboard/drivers — fleet status for Command Center
  // P-PERF6: Parallel fetch of drivers + route/stop counts via single SQL JOIN
  app.get('/drivers', {
    preHandler: requireOrgRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    // P-PERF7: ?fields=map includes GPS coords; omit by default (HIPAA minimum-necessary)
    const q = req.query as { depotId?: string; fields?: string };
    const includeGps = q.fields === 'map';
    const today = todayInTz();

    type DriverRow = { id: string; name: string; status: string; vehicleType: string | null; currentLat: number | null; currentLng: number | null; lastPingAt: Date | null };
    type RouteCountRow = { driver_id: string; route_id: string; route_status: string; total_stops: number; completed_stops: number };

    const [allDrivers, routeCountRows] = await Promise.all([
      // P-PERF10: prepared statement for driver list (most-hit dashboard query)
      getDashboardDrivers.execute({ orgId }),
      db.execute(sql`
        SELECT
          r.driver_id,
          r.id           AS route_id,
          r.status       AS route_status,
          COUNT(s.id)::int                                         AS total_stops,
          COUNT(s.id) FILTER (WHERE s.status = 'completed')::int  AS completed_stops
        FROM routes r
        JOIN plans p ON p.id = r.plan_id
          AND p.org_id     = ${orgId}
          AND p.deleted_at IS NULL
          AND p.date       = ${today}
          ${q.depotId ? sql`AND p.depot_id = ${q.depotId}` : sql``}
        LEFT JOIN stops s ON s.route_id = r.id AND s.deleted_at IS NULL AND s.org_id = ${orgId}
        WHERE r.deleted_at IS NULL
          AND r.driver_id IS NOT NULL
        GROUP BY r.driver_id, r.id, r.status
      `) as unknown as RouteCountRow[],
    ]);

    if (allDrivers.length === 0) return { drivers: [] };

    const driverRouteMap = new Map(
      routeCountRows.map(r => [r.driver_id, { routeId: r.route_id, routeStatus: r.route_status, totalStops: r.total_stops, completedStops: r.completed_stops }])
    );

    return {
      drivers: allDrivers.map(d => {
        const base = {
          id: d.id, name: d.name, status: d.status, vehicleType: d.vehicleType,
          ...(driverRouteMap.get(d.id) ?? { routeId: null, routeStatus: null, totalStops: 0, completedStops: 0 }),
        };
        // P-PERF7: strip GPS coords unless ?fields=map (HIPAA minimum-necessary: driver traces = PHI proximity data)
        if (includeGps) return { ...base, currentLat: d.currentLat, currentLng: d.currentLng, lastPingAt: d.lastPingAt?.toISOString() ?? null };
        return base;
      }),
    };
  });

  // GET /orgs/:orgId/dashboard/combined — P-PERF9: single endpoint returns summary + drivers + plans
  // Replaces 3 independent polling timers (summaryTimer 60s + driversTimer 30s + plansTimer 60s)
  // with one 30s combined call. 66% HTTP reduction, eliminates visual jank from staggered updates.
  // P-PERF14: LRU cache 15s TTL (5s for GPS/map variant). Stale-while-revalidate via setImmediate.
  app.get('/combined', {
    preHandler: requireOrgRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const q = req.query as { depotId?: string; date?: string; fields?: string };
    const today = q.date ?? todayInTz();
    const includeGps = q.fields === 'map';

    // P-PERF14: check cache first (stale-while-revalidate)
    const cacheKey = dashboardCombinedKey(orgId, { depotId: q.depotId, date: q.date, fields: q.fields });
    const cached = getDashboardCached(cacheKey, includeGps, () => computeCombined(orgId, q, today, includeGps));
    if (cached !== null) return cached;

    const result = await computeCombined(orgId, q, today, includeGps);
    setDashboardCached(cacheKey, result, includeGps);
    return result;
  });

  // GET /orgs/:orgId/dashboard/today — single aggregate: plans + routes + stops
  // P-PERF6: Single SQL JOIN replaces 3-serial-waterfall.
  app.get('/today', {
    preHandler: requireOrgRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const q = req.query as { date?: string; depotId?: string };
    const today = q.date ?? todayInTz();

    type PlanRow = { id: string; date: string; status: string; depot_id: string };
    type JoinRow = {
      route_id: string; plan_id: string; driver_id: string | null;
      route_status: string; stop_order: unknown; estimated_duration: number | null;
      stop_id: string | null; stop_status: string | null; stop_route_id: string | null;
    };

    // Parallel: fetch plans + (routes + stops via single JOIN query)
    const [planRows, joinRows] = await Promise.all([
      db.execute(sql`
        SELECT id, date, status, depot_id
        FROM plans
        WHERE org_id     = ${orgId}
          AND deleted_at IS NULL
          AND date       = ${today}
          ${q.depotId ? sql`AND depot_id = ${q.depotId}` : sql``}
        ORDER BY created_at DESC
      `) as unknown as PlanRow[],
      db.execute(sql`
        SELECT
          r.id AS route_id, r.plan_id, r.driver_id, r.status AS route_status,
          r.stop_order, r.estimated_duration,
          s.id AS stop_id, s.status AS stop_status, s.route_id AS stop_route_id
        FROM routes r
        LEFT JOIN stops s ON s.route_id = r.id AND s.deleted_at IS NULL AND s.org_id = ${orgId}
        JOIN plans p ON p.id = r.plan_id
          AND p.org_id     = ${orgId}
          AND p.deleted_at IS NULL
          AND p.date       = ${today}
          ${q.depotId ? sql`AND p.depot_id = ${q.depotId}` : sql``}
        WHERE r.deleted_at IS NULL
      `) as unknown as JoinRow[],
    ]);

    if (planRows.length === 0) return { plans: [] };

    type StopSlim = { id: string; status: string; routeId: string | null };
    type RouteWithStops = { id: string; planId: string; driverId: string | null; status: string; stopOrder: unknown; estimatedDuration: number | null; stops: StopSlim[] };
    type PlanWithRoutes = { id: string; date: string; status: string; depotId: string; routes: RouteWithStops[] };

    const routeMap = new Map<string, RouteWithStops>();
    const planMap = new Map<string, PlanWithRoutes>(
      planRows.map(p => [p.id, { id: p.id, date: p.date, status: p.status, depotId: p.depot_id, routes: [] }])
    );

    for (const row of joinRows) {
      if (!routeMap.has(row.route_id)) {
        const route: RouteWithStops = {
          id: row.route_id, planId: row.plan_id, driverId: row.driver_id,
          status: row.route_status, stopOrder: row.stop_order,
          estimatedDuration: row.estimated_duration, stops: [],
        };
        routeMap.set(row.route_id, route);
        planMap.get(row.plan_id)?.routes.push(route);
      }
      if (row.stop_id) {
        routeMap.get(row.route_id)?.stops.push({ id: row.stop_id, status: row.stop_status!, routeId: row.stop_route_id });
      }
    }

    return { plans: [...planMap.values()] };
  });
};
