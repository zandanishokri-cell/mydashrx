import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { stops, routes, drivers } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export const trackingRoutes: FastifyPluginAsync = async (app) => {
  // Public — no auth. Returns only patient-safe data. No PHI.
  app.get('/:token', async (req, reply) => {
    const { token } = req.params as { token: string };

    // Explicit column select — never expose PHI if schema grows
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

    const driverInfo = route
      ? await db
          .select({
            currentLat: drivers.currentLat,
            currentLng: drivers.currentLng,
            lastPingAt: drivers.lastPingAt,
          })
          .from(drivers)
          .where(eq(drivers.id, route.driverId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : null;

    const stopOrder: string[] = (route?.stopOrder as string[]) ?? [];
    const stopsAhead = Math.max(0, stopOrder.indexOf(stop.id));

    return {
      stopId: stop.id,
      status: stop.status,
      // First name only — no last name, no address, no Rx numbers
      recipientName: stop.recipientName.split(' ')[0],
      stopsAhead,
      windowStart: stop.windowStart,
      windowEnd: stop.windowEnd,
      completedAt: stop.completedAt,
      // Driver location only revealed when ≤2 stops away
      driverLocation:
        stopsAhead <= 2 && driverInfo
          ? {
              lat: driverInfo.currentLat,
              lng: driverInfo.currentLng,
              lastPingAt: driverInfo.lastPingAt,
            }
          : null,
    };
  });
};
