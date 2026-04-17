import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { stops, routes, drivers, plans, driverLocationHistory } from '../db/schema.js';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { requireOrgRole } from '../middleware/requireOrgRole.js';
import { todayInTz } from '../utils/date.js';

// HIPAA-safe: "Smith, J." format
const hipaaName = (full: string) => {
  const parts = full.trim().split(' ');
  if (parts.length < 2) return parts[0];
  return `${parts[parts.length - 1]}, ${parts[0][0]}.`;
};

export const ETA_PER_STOP_MS = 8 * 60 * 1000;

// ─── Public patient-facing tracking ──────────────────────────────────────────
export const trackingRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:token', async (req, reply) => {
    const { token } = req.params as { token: string };

    const [stop] = await db
      .select({
        id: stops.id,
        routeId: stops.routeId,
        status: stops.status,
        recipientName: stops.recipientName,
        trackingToken: stops.trackingToken,
        windowStart: stops.windowStart,
        windowEnd: stops.windowEnd,
        completedAt: stops.completedAt,
      })
      .from(stops)
      .where(eq(stops.trackingToken, token as any))
      .limit(1);
    if (!stop) return reply.code(404).send({ error: 'Not found' });

    const [route] = stop.routeId
      ? await db.select().from(routes).where(eq(routes.id, stop.routeId)).limit(1)
      : [null];

    const driverInfo = route?.driverId
      ? await db
          .select({ currentLat: drivers.currentLat, currentLng: drivers.currentLng, lastPingAt: drivers.lastPingAt })
          .from(drivers)
          .where(eq(drivers.id, route.driverId as string))
          .limit(1)
          .then((r) => r[0] ?? null)
      : null;

    const stopOrder: string[] = (route?.stopOrder as string[]) ?? [];
    const stopsAhead = Math.max(0, stopOrder.indexOf(stop.id));

    // Dynamic ETA: stopsAhead * 8 min from lastPingAt (or now). Null when 0 stops ahead ("arriving soon") or terminal.
    const estimatedArrivalAt = (() => {
      if (stop.status === 'completed' || stop.status === 'failed' || stop.status === 'rescheduled') return null;
      if (stopsAhead === 0) return null;
      const base = driverInfo?.lastPingAt ? new Date(driverInfo.lastPingAt) : new Date();
      return new Date(base.getTime() + stopsAhead * ETA_PER_STOP_MS).toISOString();
    })();

    return {
      stopId: stop.id,
      status: stop.status,
      recipientName: stop.recipientName.split(' ')[0], // first name only — HIPAA-safe
      routeActive: route?.status === 'active',
      stopsAhead,
      estimatedArrivalAt,
      windowStart: stop.windowStart,
      windowEnd: stop.windowEnd,
      completedAt: stop.completedAt,
      driverLocation:
        stopsAhead <= 2 && driverInfo
          ? { lat: driverInfo.currentLat, lng: driverInfo.currentLng, lastPingAt: driverInfo.lastPingAt }
          : null,
    };
  });
};

// ─── Internal dispatcher/admin live tracking ──────────────────────────────────
// Registered at prefix /api/v1/orgs/:orgId/tracking
export const liveTrackingRoutes: FastifyPluginAsync = async (app) => {

  // GET /orgs/:orgId/tracking/live
  app.get('/live', {
    preHandler: requireOrgRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };

    const activeRoutes = await db
      .select({
        routeId: routes.id,
        routeStatus: routes.status,
        stopOrder: routes.stopOrder,
        driverId: drivers.id,
        driverName: drivers.name,
        driverPhone: drivers.phone,
        driverStatus: drivers.status,
        currentLat: drivers.currentLat,
        currentLng: drivers.currentLng,
        lastPingAt: drivers.lastPingAt,
      })
      .from(routes)
      .innerJoin(plans, and(eq(routes.planId, plans.id), eq(plans.orgId, orgId), isNull(plans.deletedAt)))
      .innerJoin(drivers, and(eq(routes.driverId, drivers.id), eq(drivers.orgId, orgId)))
      .where(and(eq(routes.status, 'active'), eq(drivers.status, 'on_route'), isNull(routes.deletedAt)));

    if (activeRoutes.length === 0) {
      return { activeRoutes: [], summary: { activeDrivers: 0, totalStopsRemaining: 0, completedToday: 0 } };
    }

    const routeIds = activeRoutes.map((r) => r.routeId);

    const allStops = await db
      .select({
        id: stops.id,
        routeId: stops.routeId,
        status: stops.status,
        address: stops.address,
        recipientName: stops.recipientName,
        sequenceNumber: stops.sequenceNumber,
      })
      .from(stops)
      .where(and(inArray(stops.routeId, routeIds), isNull(stops.deletedAt)));

    // Count completed stops across all of today's org routes
    const today = todayInTz();
    const todayPlanRows = await db
      .select({ id: plans.id })
      .from(plans)
      .where(and(eq(plans.orgId, orgId), eq(plans.date, today), isNull(plans.deletedAt)));

    let completedToday = 0;
    if (todayPlanRows.length > 0) {
      const todayRouteRows = await db.select({ id: routes.id })
        .from(routes)
        .where(and(inArray(routes.planId, todayPlanRows.map((p) => p.id)), isNull(routes.deletedAt)));
      if (todayRouteRows.length > 0) {
        const doneStops = await db.select({ id: stops.id })
          .from(stops)
          .where(and(
            inArray(stops.routeId, todayRouteRows.map((r) => r.id)),
            eq(stops.status, 'completed'),
            isNull(stops.deletedAt),
          ));
        completedToday = doneStops.length;
      }
    }

    const stopsByRoute = allStops.reduce<Record<string, typeof allStops>>((acc, s) => {
      if (!s.routeId) return acc;
      (acc[s.routeId] ??= []).push(s);
      return acc;
    }, {});

    let totalStopsRemaining = 0;

    const result = activeRoutes.map((r) => {
      const rs = stopsByRoute[r.routeId] ?? [];
      const completed = rs.filter((s) => s.status === 'completed' || s.status === 'failed' || s.status === 'rescheduled').length;
      const pending = rs.filter((s) => s.status !== 'completed' && s.status !== 'failed' && s.status !== 'rescheduled').length;
      totalStopsRemaining += pending;

      const nextStop = rs
        .filter((s) => s.status !== 'completed' && s.status !== 'failed' && s.status !== 'rescheduled')
        .sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0))[0] ?? null;

      const base = new Date(); // always project from now — stale lastPingAt produces past ETAs
      return {
        routeId: r.routeId,
        driverId: r.driverId,
        driverName: r.driverName,
        driverPhone: r.driverPhone,
        status: r.routeStatus,
        currentLat: r.currentLat,
        currentLng: r.currentLng,
        lastPingAt: r.lastPingAt,
        stopsTotal: rs.length,
        stopsCompleted: completed,
        stopsPending: pending,
        nextStop: nextStop
          ? { stopId: nextStop.id, address: nextStop.address, recipientName: hipaaName(nextStop.recipientName), status: nextStop.status }
          : null,
        estimatedCompletion: new Date(base.getTime() + pending * ETA_PER_STOP_MS).toISOString(),
      };
    });

    return { activeRoutes: result, summary: { activeDrivers: result.length, totalStopsRemaining, completedToday } };
  });

  // GET /orgs/:orgId/tracking/route/:routeId
  app.get('/route/:routeId', {
    preHandler: requireOrgRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId, routeId } = req.params as { orgId: string; routeId: string };

    const [route] = await db
      .select({
        id: routes.id,
        status: routes.status,
        driverId: drivers.id,
        driverName: drivers.name,
        driverPhone: drivers.phone,
        driverStatus: drivers.status,
        currentLat: drivers.currentLat,
        currentLng: drivers.currentLng,
        lastPingAt: drivers.lastPingAt,
      })
      .from(routes)
      .innerJoin(plans, and(eq(routes.planId, plans.id), eq(plans.orgId, orgId), isNull(plans.deletedAt)))
      .innerJoin(drivers, and(eq(routes.driverId, drivers.id), eq(drivers.orgId, orgId)))
      .where(and(eq(routes.id, routeId), isNull(routes.deletedAt)))
      .limit(1);

    if (!route) return reply.code(404).send({ error: 'Route not found' });

    const routeStops = await db
      .select({
        id: stops.id,
        status: stops.status,
        address: stops.address,
        recipientName: stops.recipientName,
        sequenceNumber: stops.sequenceNumber,
        lat: stops.lat,
        lng: stops.lng,
        arrivedAt: stops.arrivedAt,
        completedAt: stops.completedAt,
      })
      .from(stops)
      .where(and(eq(stops.routeId, routeId), isNull(stops.deletedAt)))
      .orderBy(stops.sequenceNumber);

    const pending = routeStops.filter((s) => s.status !== 'completed' && s.status !== 'failed' && s.status !== 'rescheduled');
    const base = new Date(); // always project from now — stale lastPingAt produces past ETAs

    return {
      routeId: route.id,
      status: route.status,
      driver: {
        id: route.driverId,
        name: route.driverName,
        phone: route.driverPhone,
        status: route.driverStatus,
        currentLat: route.currentLat,
        currentLng: route.currentLng,
        lastPingAt: route.lastPingAt,
      },
      stops: routeStops.map((s, i) => ({
        stopId: s.id,
        sequenceNumber: s.sequenceNumber ?? i,
        status: s.status,
        address: s.address,
        recipientName: hipaaName(s.recipientName),
        lat: s.lat,
        lng: s.lng,
        arrivedAt: s.arrivedAt,
        completedAt: s.completedAt,
        estimatedArrival: (() => {
          const pos = pending.findIndex((p) => p.id === s.id);
          return pos < 0 ? null : new Date(base.getTime() + (pos + 1) * ETA_PER_STOP_MS).toISOString();
        })(),
      })),
      summary: {
        stopsTotal: routeStops.length,
        stopsCompleted: routeStops.filter((s) => s.status === 'completed').length,
        stopsFailed: routeStops.filter((s) => s.status === 'failed').length,
        stopsPending: pending.length,
        estimatedCompletion: new Date(base.getTime() + pending.length * ETA_PER_STOP_MS).toISOString(),
      },
    };
  });

  // POST /orgs/:orgId/tracking/ping — driver location ping
  app.post('/ping', {
    preHandler: requireOrgRole('driver'),
  }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const { lat, lng } = req.body as { lat: number; lng: number };
    if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return reply.code(400).send({ error: 'lat/lng required and must be valid coordinates' });
    }
    // Use driverId from JWT — never from body (prevents GPS spoofing of other drivers)
    const jwtUser = req.user as { sub: string; driverId?: string };
    const driverId = jwtUser.driverId ?? jwtUser.sub;

    const now = new Date();
    await db.update(drivers)
      .set({ currentLat: lat, currentLng: lng, lastPingAt: now })
      .where(and(eq(drivers.id, driverId), eq(drivers.orgId, orgId)));

    // Append to location history (same as driverApp /me/location)
    await db.insert(driverLocationHistory).values({ driverId, routeId: null, lat, lng, recordedAt: now });

    return { ok: true, recordedAt: now.toISOString() };
  });
};
