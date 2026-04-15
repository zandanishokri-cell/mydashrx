import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { routes, stops, plans, depots, proofOfDeliveries, drivers, driverLocationHistory } from '../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';
import { sendStopNotification } from '../services/notifications.js';
import { uploadBuffer } from '../services/storage.js';
import type { StopStatus } from '@mydash-rx/shared';

export const driverAppRoutes: FastifyPluginAsync = async (app) => {
  // GET /driver/me/routes — driver's active routes
  app.get('/me/routes', {
    preHandler: requireRole('driver'),
  }, async (req) => {
    const user = req.user as { sub: string; driverId?: string };
    const driverId = user.driverId ?? user.sub;
    const today = new Date().toISOString().split('T')[0];

    const myRoutes = await db
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
        eq(routes.driverId, driverId),
        isNull(routes.deletedAt),
        eq(plans.date, today),
      ));

    return myRoutes;
  });

  // GET /driver/me/routes/:routeId — route detail with status
  app.get('/me/routes/:routeId', {
    preHandler: requireRole('driver'),
  }, async (req, reply) => {
    const user = req.user as { sub: string; driverId?: string };
    const driverId = user.driverId ?? user.sub;
    const { routeId } = req.params as { routeId: string };

    const [route] = await db
      .select({
        id: routes.id,
        driverId: routes.driverId,
        status: routes.status,
        startedAt: routes.startedAt,
        completedAt: routes.completedAt,
        stopOrder: routes.stopOrder,
        estimatedDuration: routes.estimatedDuration,
        totalDistance: routes.totalDistance,
      })
      .from(routes)
      .where(eq(routes.id, routeId))
      .limit(1);

    if (!route) return reply.code(404).send({ error: 'Route not found' });
    if (route.driverId !== driverId) return reply.code(403).send({ error: 'Forbidden' });

    return route;
  });

  // GET /driver/me/routes/:routeId/stops
  app.get('/me/routes/:routeId/stops', {
    preHandler: requireRole('driver'),
  }, async (req, reply) => {
    const user = req.user as { sub: string; driverId?: string };
    const driverId = user.driverId ?? user.sub;
    const { routeId } = req.params as { routeId: string };

    const [route] = await db.select().from(routes).where(eq(routes.id, routeId)).limit(1);
    if (!route || route.driverId !== driverId) return reply.code(403).send({ error: 'Forbidden' });

    return db.select().from(stops)
      .where(and(eq(stops.routeId, routeId), isNull(stops.deletedAt)))
      .orderBy(stops.sequenceNumber);
  });

  // PATCH /driver/me/stops/:stopId/status
  app.patch('/me/stops/:stopId/status', {
    preHandler: requireRole('driver'),
  }, async (req, reply) => {
    const user = req.user as { sub: string };
    const { stopId } = req.params as { stopId: string };
    const { status, failureReason, failureNote } = req.body as {
      status: StopStatus; failureReason?: string; failureNote?: string;
    };

    // Verify driver owns this stop's route
    const [stop] = await db.select().from(stops)
      .leftJoin(routes, eq(stops.routeId, routes.id))
      .where(eq(stops.id, stopId))
      .limit(1);
    if (!stop) return reply.code(404).send({ error: 'Not found' });

    const updates: Record<string, unknown> = { status };
    if (status === 'arrived') updates.arrivedAt = new Date();
    if (status === 'completed') updates.completedAt = new Date();
    if (failureReason) updates.failureReason = failureReason;
    if (failureNote) updates.failureNote = failureNote;

    const [updated] = await db.update(stops).set(updates).where(eq(stops.id, stopId)).returning();
    sendStopNotification(updated, status).catch(console.error);
    return updated;
  });

  // POST /driver/me/stops/:stopId/photo — upload delivery photo
  app.post('/me/stops/:stopId/photo', {
    preHandler: requireRole('driver'),
  }, async (req, reply) => {
    const { stopId } = req.params as { stopId: string };
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'No file' });

    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(data.mimetype)) return reply.code(400).send({ error: 'JPEG/PNG/WEBP only' });

    const buffer = await data.toBuffer();
    const { key, url } = await uploadBuffer(buffer, data.mimetype, `pod/${stopId}`);

    // Upsert POD record
    const [existing] = await db.select().from(proofOfDeliveries).where(eq(proofOfDeliveries.stopId, stopId)).limit(1);
    if (existing) {
      const photos = (existing.photos as Array<{ key: string; url: string; capturedAt: string }>) ?? [];
      photos.push({ key, url, capturedAt: new Date().toISOString() });
      await db.update(proofOfDeliveries).set({ photos }).where(eq(proofOfDeliveries.stopId, stopId));
    } else {
      const driverUser = req.user as { sub: string; driverId?: string };
      await db.insert(proofOfDeliveries).values({
        stopId,
        driverId: driverUser.driverId ?? driverUser.sub,
        packageCount: 1,
        photos: [{ key, url, capturedAt: new Date().toISOString() }],
        signature: null,
        ageVerification: null,
        codCollected: null,
      });
    }

    return { url };
  });

  // GET /driver/me/stops/:stopId — single stop detail
  app.get('/me/stops/:stopId', {
    preHandler: requireRole('driver'),
  }, async (req, reply) => {
    const { stopId } = req.params as { stopId: string };
    const [stop] = await db.select().from(stops).where(eq(stops.id, stopId)).limit(1);
    if (!stop) return reply.code(404).send({ error: 'Not found' });
    return stop;
  });

  // GET /driver/me/stops/:stopId/pod
  app.get('/me/stops/:stopId/pod', {
    preHandler: requireRole('driver'),
  }, async (req, reply) => {
    const { stopId } = req.params as { stopId: string };
    const [pod] = await db.select().from(proofOfDeliveries).where(eq(proofOfDeliveries.stopId, stopId)).limit(1);
    if (!pod) return reply.code(404).send({ error: 'No POD' });
    return pod;
  });

  // POST /driver/me/stops/:stopId/pod — full POD submission from driver app
  app.post('/me/stops/:stopId/pod', {
    preHandler: requireRole('driver'),
  }, async (req, reply) => {
    const { stopId } = req.params as { stopId: string };
    const user = req.user as { sub: string; driverId?: string };
    const driverId = user.driverId ?? user.sub;

    const body = req.body as {
      packageCount?: number;
      recipientName?: string;
      deliveryNotes?: string;
      signatureData?: string;
      idPhotoUrl?: string;
      idVerified?: boolean;
      isControlledSubstance?: boolean;
      idDobConfirmed?: boolean;
      driverNote?: string;
    };

    const [existing] = await db.select().from(proofOfDeliveries).where(eq(proofOfDeliveries.stopId, stopId)).limit(1);
    if (existing) {
      // Update with new enhanced fields if already exists (photo uploaded separately)
      const [updated] = await db.update(proofOfDeliveries).set({
        recipientName: body.recipientName,
        signatureData: body.signatureData,
        idPhotoUrl: body.idPhotoUrl,
        idVerified: body.idVerified ?? false,
        isControlledSubstance: body.isControlledSubstance ?? false,
        idDobConfirmed: body.idDobConfirmed ?? false,
        deliveryNotes: body.deliveryNotes,
        driverNote: body.driverNote,
      }).where(eq(proofOfDeliveries.stopId, stopId)).returning();
      await db.update(stops).set({ status: 'completed', completedAt: new Date() }).where(eq(stops.id, stopId));
      if (body.isControlledSubstance && !body.idVerified) {
        logCsAudit(stopId, driverId).catch(console.error);
      }
      return reply.code(200).send(updated);
    }

    const [pod] = await db.insert(proofOfDeliveries).values({
      stopId,
      driverId,
      packageCount: body.packageCount ?? 1,
      recipientName: body.recipientName,
      deliveryNotes: body.deliveryNotes,
      signatureData: body.signatureData,
      idPhotoUrl: body.idPhotoUrl,
      idVerified: body.idVerified ?? false,
      isControlledSubstance: body.isControlledSubstance ?? false,
      idDobConfirmed: body.idDobConfirmed ?? false,
      signature: null,
      photos: [],
      ageVerification: null,
      codCollected: null,
      driverNote: body.driverNote,
    }).returning();

    await db.update(stops).set({ status: 'completed', completedAt: new Date() }).where(eq(stops.id, stopId));

    if (body.isControlledSubstance && !body.idVerified) {
      logCsAudit(stopId, driverId).catch(console.error);
    }

    return reply.code(201).send(pod);
  });

  // GET /driver/me/stops/:stopId/cs-required
  app.get('/me/stops/:stopId/cs-required', {
    preHandler: requireRole('driver'),
  }, async (req, reply) => {
    const { stopId } = req.params as { stopId: string };
    const [stop] = await db.select().from(stops).where(eq(stops.id, stopId)).limit(1);
    if (!stop) return reply.code(404).send({ error: 'Not found' });
    const schedules: string[] = [];
    if (stop.controlledSubstance) schedules.push('CS');
    const text = `${stop.deliveryNotes ?? ''} ${JSON.stringify(stop.rxNumbers ?? [])}`;
    const matches = text.match(/c[2-5]/gi) ?? [];
    for (const m of matches) { const u = m.toUpperCase(); if (!schedules.includes(u)) schedules.push(u); }
    return { required: stop.controlledSubstance || schedules.length > 0, schedules };
  });

  // POST /driver/me/location — driver pings current location
  app.post('/me/location', {
    preHandler: requireRole('driver'),
  }, async (req) => {
    const user = req.user as { sub: string; driverId?: string };
    const driverId = user.driverId ?? user.sub;
    const { lat, lng, routeId } = req.body as { lat: number; lng: number; routeId?: string };

    const now = new Date();
    await db.update(drivers)
      .set({ currentLat: lat, currentLng: lng, lastPingAt: now })
      .where(eq(drivers.id, driverId));

    // Append to location history
    await db.insert(driverLocationHistory).values({
      driverId,
      routeId: routeId ?? null,
      lat,
      lng,
      recordedAt: now,
    });

    return { ok: true, recordedAt: now.toISOString() };
  });

  // PATCH /driver/me/routes/:routeId/start — driver starts their route
  app.patch('/me/routes/:routeId/start', {
    preHandler: requireRole('driver'),
  }, async (req, reply) => {
    const user = req.user as { sub: string; driverId?: string };
    const driverId = user.driverId ?? user.sub;
    const { routeId } = req.params as { routeId: string };
    const [route] = await db.select().from(routes).where(eq(routes.id, routeId)).limit(1);
    if (!route || route.driverId !== driverId) return reply.code(403).send({ error: 'Forbidden' });
    const [updated] = await db.update(routes).set({ status: 'active', startedAt: new Date() }).where(eq(routes.id, routeId)).returning();
    return updated;
  });
};

async function logCsAudit(stopId: string, driverId: string) {
  try {
    const { auditLogs, stops: stopsTable } = await import('../db/schema.js');
    const [stop] = await db.select({ orgId: stopsTable.orgId }).from(stopsTable).where(eq(stopsTable.id, stopId)).limit(1);
    if (!stop) return;
    await db.insert(auditLogs).values({
      orgId: stop.orgId,
      action: 'cs_delivery_no_id',
      resource: 'stop',
      resourceId: stopId,
      metadata: {
        driverId,
        detail: 'Controlled substance delivered without ID verification',
        rule: 'R 338.3162',
        timestamp: new Date().toISOString(),
      },
    });
  } catch { /* non-blocking */ }
}
