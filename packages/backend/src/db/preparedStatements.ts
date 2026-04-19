// P-PERF10: Drizzle prepared statements for hot-path queries
// Prepared statements are parsed + planned once by Postgres, then reused on every call.
// These two queries run on every driver poll (~5s) and every dashboard poll (~30s).
import { db } from './connection.js';
import { routes, stops, plans, depots, drivers } from './schema.js';
import { eq, and, isNull, sql } from 'drizzle-orm';

// ─── GET /driver/me/routes hot-path ──────────────────────────────────────────
// Called every poll cycle on the driver mobile view — most frequent query in the system.
// Placeholder: driverId (string), planDate (string YYYY-MM-DD)
export const getDriverRoutes = db
  .select({
    id: routes.id,
    planId: routes.planId,
    status: routes.status,
    stopOrder: routes.stopOrder,
    estimatedDuration: routes.estimatedDuration,
    totalDistance: routes.totalDistance,
    startedAt: routes.startedAt,
    planDate: plans.date,
    planStatus: plans.status,
    depotName: depots.name,
    depotLat: depots.lat,
    depotLng: depots.lng,
  })
  .from(routes)
  .leftJoin(plans, eq(routes.planId, plans.id))
  .leftJoin(depots, eq(plans.depotId, depots.id))
  .where(and(
    eq(routes.driverId, sql.placeholder('driverId')),
    isNull(routes.deletedAt),
    eq(plans.date, sql.placeholder('planDate')),
  ))
  .prepare('get_driver_routes');

// ─── GET /orgs/:orgId/dashboard/drivers hot-path ─────────────────────────────
// Called every 30s on the pharmacy/dispatcher dashboard for fleet status.
// Returns all active drivers for an org.
export const getDashboardDrivers = db
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
  .where(and(
    eq(drivers.orgId, sql.placeholder('orgId')),
    isNull(drivers.deletedAt),
  ))
  .prepare('get_dashboard_drivers');
