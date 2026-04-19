import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { routes, stops, plans, depots, proofOfDeliveries, drivers, driverLocationHistory } from '../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';
import { sendStopNotification, sendTwilioSms } from '../services/notifications.js';
import { sendCopayPaymentLink } from '../services/paymentLink.js';
import { fireTrigger } from '../services/automation.js';
import { uploadBuffer } from '../services/storage.js';
import type { StopStatus } from '@mydash-rx/shared';
import { todayInTz } from '../utils/date.js';

async function resolveDriverId(
  user: { driverId?: string; email: string; orgId: string },
): Promise<string | null> {
  if (user.driverId) return user.driverId;
  const [dr] = await db
    .select({ id: drivers.id })
    .from(drivers)
    .where(and(eq(drivers.email, user.email), eq(drivers.orgId, user.orgId), isNull(drivers.deletedAt)))
    .limit(1);
  return dr?.id ?? null;
}

export const driverAppRoutes: FastifyPluginAsync = async (app) => {
  // GET /driver/me — driver profile + status
  app.get('/me', {
    preHandler: requireRole('driver'),
  }, async (req, reply) => {
    const user = req.user as { sub: string; driverId?: string; email: string; orgId: string };
    const driverId = await resolveDriverId(user);
    if (!driverId) return reply.code(404).send({ error: 'Driver record not found' });
    const [driver] = await db
      .select({ id: drivers.id, name: drivers.name, status: drivers.status })
      .from(drivers)
      .where(eq(drivers.id, driverId))
      .limit(1);
    if (!driver) return reply.code(404).send({ error: 'Not found' });
    return driver;
  });

  // GET /driver/me/routes — driver's active routes
  app.get('/me/routes', {
    preHandler: requireRole('driver'),
  }, async (req, reply) => {
    const user = req.user as { sub: string; driverId?: string; email: string; orgId: string };
    const driverId = await resolveDriverId(user);
    if (!driverId) return reply.code(404).send({ error: 'Driver record not found' });
    const today = todayInTz();

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
    const user = req.user as { sub: string; driverId?: string; email: string; orgId: string };
    const driverId = await resolveDriverId(user);
    if (!driverId) return reply.code(404).send({ error: 'Driver record not found' });
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
      .where(and(eq(routes.id, routeId), isNull(routes.deletedAt)))
      .limit(1);

    if (!route) return reply.code(404).send({ error: 'Route not found' });
    if (route.driverId !== driverId) return reply.code(403).send({ error: 'Forbidden' });

    return route;
  });

  // GET /driver/me/routes/:routeId/eta — P-DEL8: dynamic ETA using Haversine + rolling actual avg
  app.get('/me/routes/:routeId/eta', {
    preHandler: requireRole('driver'),
  }, async (req, reply) => {
    const user = req.user as { sub: string; driverId?: string; email: string; orgId: string };
    const driverId = await resolveDriverId(user);
    if (!driverId) return reply.code(404).send({ error: 'Driver record not found' });
    const { routeId } = req.params as { routeId: string };

    const [route] = await db.select({ driverId: routes.driverId, startedAt: routes.startedAt })
      .from(routes).where(and(eq(routes.id, routeId), isNull(routes.deletedAt))).limit(1);
    if (!route || route.driverId !== driverId) return reply.code(403).send({ error: 'Forbidden' });

    // Get driver current position
    const [driver] = await db.select({ currentLat: drivers.currentLat, currentLng: drivers.currentLng })
      .from(drivers).where(eq(drivers.id, driverId)).limit(1);

    // Get all non-deleted stops for this route
    const allStops = await db.select({
      id: stops.id,
      status: stops.status,
      lat: stops.lat,
      lng: stops.lng,
      arrivedAt: stops.arrivedAt,
      completedAt: stops.completedAt,
    }).from(stops).where(and(eq(stops.routeId, routeId), isNull(stops.deletedAt)))
      .orderBy(stops.sequenceNumber);

    const remaining = allStops.filter(s => s.status !== 'completed' && s.status !== 'failed' && s.status !== 'rescheduled');

    // Rolling avg: actual min/stop from completed stops today
    const completed = allStops.filter(s => s.status === 'completed' && s.arrivedAt && s.completedAt);
    let avgMinPerStop = 8; // fallback constant
    if (completed.length >= 2) {
      const durations = completed.map(s => (new Date(s.completedAt!).getTime() - new Date(s.arrivedAt!).getTime()) / 60000);
      avgMinPerStop = durations.reduce((a, b) => a + b, 0) / durations.length;
      avgMinPerStop = Math.max(2, Math.min(avgMinPerStop, 30)); // clamp 2-30min
    }

    // Haversine to next stop
    const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLng = (lng2 - lng1) * Math.PI / 180;
      const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    };

    let distanceToNextKm: number | null = null;
    if (driver?.currentLat && driver?.currentLng && remaining.length > 0) {
      const next = remaining[0];
      if (next.lat && next.lng) {
        distanceToNextKm = haversineKm(driver.currentLat, driver.currentLng, next.lat, next.lng);
      }
    }

    // Travel time to next stop: assume 30km/h avg urban speed
    const travelMinToNext = distanceToNextKm != null ? (distanceToNextKm / 30) * 60 : 0;
    const totalMinRemaining = travelMinToNext + (remaining.length * avgMinPerStop);
    const etaTs = new Date(Date.now() + totalMinRemaining * 60 * 1000);

    return {
      remainingStops: remaining.length,
      avgMinPerStop: Math.round(avgMinPerStop * 10) / 10,
      distanceToNextKm: distanceToNextKm != null ? Math.round(distanceToNextKm * 10) / 10 : null,
      totalMinRemaining: Math.round(totalMinRemaining),
      etaIso: etaTs.toISOString(),
      completedStopsUsedForAvg: completed.length,
    };
  });

  // GET /driver/me/routes/:routeId/stops
  app.get('/me/routes/:routeId/stops', {
    preHandler: requireRole('driver'),
  }, async (req, reply) => {
    const user = req.user as { sub: string; driverId?: string; email: string; orgId: string };
    const driverId = await resolveDriverId(user);
    if (!driverId) return reply.code(404).send({ error: 'Driver record not found' });
    const { routeId } = req.params as { routeId: string };

    const [route] = await db.select().from(routes).where(eq(routes.id, routeId)).limit(1);
    if (!route || route.driverId !== driverId) return reply.code(403).send({ error: 'Forbidden' });

    return db.select().from(stops)
      .where(and(eq(stops.routeId, routeId), isNull(stops.deletedAt)))
      .orderBy(stops.sequenceNumber);
  });

  // POST /driver/me/stops/:stopId/barcode — scan and record a package barcode
  app.post('/me/stops/:stopId/barcode', {
    preHandler: requireRole('driver'),
  }, async (req, reply) => {
    const user = req.user as { sub: string; driverId?: string; email: string; orgId: string };
    const driverId = await resolveDriverId(user);
    if (!driverId) return reply.code(404).send({ error: 'Driver record not found' });
    const { stopId } = req.params as { stopId: string };
    const { barcode } = req.body as { barcode?: string };

    if (!barcode?.trim()) return reply.code(400).send({ error: 'barcode required' });

    const [stop] = await db.select({
      id: stops.id,
      routeId: stops.routeId,
      barcodesScanned: stops.barcodesScanned,
    }).from(stops).where(eq(stops.id, stopId)).limit(1);

    if (!stop) return reply.code(404).send({ error: 'Not found' });

    const [route] = await db.select({ driverId: routes.driverId })
      .from(routes)
      .where(and(eq(routes.id, stop.routeId!), isNull(routes.deletedAt)))
      .limit(1);

    if (!route || route.driverId !== driverId) return reply.code(403).send({ error: 'Forbidden' });

    const existing = Array.isArray(stop.barcodesScanned) ? (stop.barcodesScanned as string[]) : [];
    const updated = [...existing, barcode.trim()];
    const [result] = await db.update(stops)
      .set({ barcodesScanned: updated, packageConfirmed: true })
      .where(eq(stops.id, stopId))
      .returning();

    return result;
  });

  // PATCH /driver/me/stops/:stopId/status
  app.patch('/me/stops/:stopId/status', {
    preHandler: requireRole('driver'),
  }, async (req, reply) => {
    const user = req.user as { sub: string; driverId?: string; email: string; orgId: string };
    const driverId = await resolveDriverId(user);
    if (!driverId) return reply.code(404).send({ error: 'Driver record not found' });
    const { stopId } = req.params as { stopId: string };
    const { status, failureReason, failureNote } = req.body as {
      status: StopStatus; failureReason?: string; failureNote?: string;
    };

    // Verify driver owns this stop's route (fetch full stop for copay check)
    const [stop] = await db.select({
      id: stops.id, routeId: stops.routeId, orgId: stops.orgId,
      codAmount: stops.codAmount, paymentLinkSentAt: stops.paymentLinkSentAt,
      recipientName: stops.recipientName, recipientPhone: stops.recipientPhone, address: stops.address,
    }).from(stops).where(eq(stops.id, stopId)).limit(1);
    if (!stop) return reply.code(404).send({ error: 'Not found' });

    const [route] = await db.select({ driverId: routes.driverId })
      .from(routes).where(and(eq(routes.id, stop.routeId!), isNull(routes.deletedAt))).limit(1);
    if (!route || route.driverId !== driverId) return reply.code(403).send({ error: 'Forbidden' });

    const updates: Record<string, unknown> = { status };
    if (status === 'arrived') updates.arrivedAt = new Date();
    if (status === 'completed') updates.completedAt = new Date();
    if (failureReason) updates.failureReason = failureReason;
    if (failureNote) updates.failureNote = failureNote;

    const [updated] = await db.update(stops).set(updates).where(eq(stops.id, stopId)).returning();
    sendStopNotification(updated, status).catch(console.error);

    // P-COMP11: Send pre-delivery Stripe copay SMS when driver is en_route + copay > 0 (not yet sent)
    if (status === 'en_route' && (stop.codAmount ?? 0) > 0 && !stop.paymentLinkSentAt && stop.recipientPhone) {
      sendCopayPaymentLink(
        { id: stop.id, codAmount: stop.codAmount!, recipientName: stop.recipientName,
          recipientPhone: stop.recipientPhone, address: stop.address, orgId: stop.orgId },
        sendTwilioSms,
      ).catch(console.error);
    }

    return updated;
  });

  // POST /driver/me/stops/:stopId/photo — upload delivery photo
  app.post('/me/stops/:stopId/photo', {
    preHandler: requireRole('driver'),
  }, async (req, reply) => {
    const driverUser = req.user as { sub: string; driverId?: string; email: string; orgId: string };
    const driverId = await resolveDriverId(driverUser);
    if (!driverId) return reply.code(404).send({ error: 'Driver record not found' });
    const { stopId } = req.params as { stopId: string };
    // Verify ownership before accepting file upload
    const [stop] = await db.select({ id: stops.id, routeId: stops.routeId })
      .from(stops).where(eq(stops.id, stopId)).limit(1);
    if (!stop) return reply.code(404).send({ error: 'Not found' });
    const [route] = await db.select({ driverId: routes.driverId })
      .from(routes).where(and(eq(routes.id, stop.routeId!), isNull(routes.deletedAt))).limit(1);
    if (!route || route.driverId !== driverId) return reply.code(403).send({ error: 'Forbidden' });
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
      await db.insert(proofOfDeliveries).values({
        stopId,
        driverId,
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
    const user = req.user as { sub: string; driverId?: string; email: string; orgId: string };
    const driverId = await resolveDriverId(user);
    if (!driverId) return reply.code(404).send({ error: 'Driver record not found' });
    const { stopId } = req.params as { stopId: string };
    const [stop] = await db.select().from(stops).where(eq(stops.id, stopId)).limit(1);
    if (!stop) return reply.code(404).send({ error: 'Not found' });
    const [route] = await db.select({ driverId: routes.driverId })
      .from(routes).where(and(eq(routes.id, stop.routeId!), isNull(routes.deletedAt))).limit(1);
    if (!route || route.driverId !== driverId) return reply.code(403).send({ error: 'Forbidden' });
    return stop;
  });

  // GET /driver/me/stops/:stopId/pod
  app.get('/me/stops/:stopId/pod', {
    preHandler: requireRole('driver'),
  }, async (req, reply) => {
    const user = req.user as { sub: string; driverId?: string; email: string; orgId: string };
    const driverId = await resolveDriverId(user);
    if (!driverId) return reply.code(404).send({ error: 'Driver record not found' });
    const { stopId } = req.params as { stopId: string };
    const [stop] = await db.select({ id: stops.id, routeId: stops.routeId })
      .from(stops).where(eq(stops.id, stopId)).limit(1);
    if (!stop) return reply.code(404).send({ error: 'Not found' });
    const [route] = await db.select({ driverId: routes.driverId })
      .from(routes).where(and(eq(routes.id, stop.routeId!), isNull(routes.deletedAt))).limit(1);
    if (!route || route.driverId !== driverId) return reply.code(403).send({ error: 'Forbidden' });
    const [pod] = await db.select().from(proofOfDeliveries).where(eq(proofOfDeliveries.stopId, stopId)).limit(1);
    if (!pod) return reply.code(404).send({ error: 'No POD' });
    return pod;
  });

  // POST /driver/me/stops/:stopId/pod — full POD submission from driver app
  app.post('/me/stops/:stopId/pod', {
    preHandler: requireRole('driver'),
  }, async (req, reply) => {
    const { stopId } = req.params as { stopId: string };
    const user = req.user as { sub: string; driverId?: string; email: string; orgId: string };
    const driverId = await resolveDriverId(user);
    if (!driverId) return reply.code(404).send({ error: 'Driver record not found' });

    // Verify driver owns this stop's route
    const [stopCheck] = await db.select({ id: stops.id, routeId: stops.routeId, orgId: stops.orgId, recipientName: stops.recipientName, address: stops.address })
      .from(stops).where(eq(stops.id, stopId)).limit(1);
    if (!stopCheck) return reply.code(404).send({ error: 'Not found' });
    const [routeCheck] = await db.select({ driverId: routes.driverId })
      .from(routes).where(and(eq(routes.id, stopCheck.routeId!), isNull(routes.deletedAt))).limit(1);
    if (!routeCheck || routeCheck.driverId !== driverId) return reply.code(403).send({ error: 'Forbidden' });

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
      fireTrigger({
        orgId: stopCheck.orgId,
        trigger: 'stop_completed',
        resourceId: stopId,
        data: {
          patientName: stopCheck.recipientName ?? '',
          address: stopCheck.address ?? '',
          stopStatus: 'completed',
          driverName: '',
        },
      }).catch(console.error);
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
    fireTrigger({
      orgId: stopCheck.orgId,
      trigger: 'stop_completed',
      resourceId: stopId,
      data: {
        patientName: stopCheck.recipientName ?? '',
        address: stopCheck.address ?? '',
        stopStatus: 'completed',
        driverName: '',
      },
    }).catch(console.error);

    if (body.isControlledSubstance && !body.idVerified) {
      logCsAudit(stopId, driverId).catch(console.error);
    }

    return reply.code(201).send(pod);
  });

  // GET /driver/me/stops/:stopId/cs-required
  app.get('/me/stops/:stopId/cs-required', {
    preHandler: requireRole('driver'),
  }, async (req, reply) => {
    const user = req.user as { sub: string; driverId?: string; email: string; orgId: string };
    const driverId = await resolveDriverId(user);
    if (!driverId) return reply.code(404).send({ error: 'Driver record not found' });
    const { stopId } = req.params as { stopId: string };
    const [stop] = await db.select().from(stops).where(eq(stops.id, stopId)).limit(1);
    if (!stop) return reply.code(404).send({ error: 'Not found' });
    const [route] = await db.select({ driverId: routes.driverId })
      .from(routes).where(and(eq(routes.id, stop.routeId!), isNull(routes.deletedAt))).limit(1);
    if (!route || route.driverId !== driverId) return reply.code(403).send({ error: 'Forbidden' });
    const schedules: string[] = [];
    if (stop.controlledSubstance) schedules.push('CS');
    const text = `${stop.deliveryNotes ?? ''} ${JSON.stringify(stop.rxNumbers ?? [])}`;
    const matches = text.match(/c[2-5]/gi) ?? [];
    for (const m of matches) { const u = m.toUpperCase(); if (!schedules.includes(u)) schedules.push(u); }
    return { required: stop.controlledSubstance || schedules.length > 0, schedules };
  });

  // PATCH /driver/me/status — driver sets their own available/offline status
  app.patch('/me/status', {
    preHandler: requireRole('driver'),
  }, async (req, reply) => {
    const user = req.user as { sub: string; driverId?: string; email: string; orgId: string };
    const driverId = await resolveDriverId(user);
    if (!driverId) return reply.code(404).send({ error: 'Driver record not found' });
    const { status } = req.body as { status?: string };
    if (status !== 'available' && status !== 'offline') {
      return reply.code(400).send({ error: 'status must be available or offline' });
    }
    const [updated] = await db.update(drivers)
      .set({ status })
      .where(eq(drivers.id, driverId))
      .returning({ status: drivers.status });
    if (!updated) return reply.code(404).send({ error: 'Driver not found' });
    return { status: updated.status };
  });

  // POST /driver/me/location — driver pings current location
  app.post('/me/location', {
    preHandler: requireRole('driver'),
  }, async (req, reply) => {
    const user = req.user as { sub: string; driverId?: string; email: string; orgId: string };
    const driverId = await resolveDriverId(user);
    if (!driverId) return reply.code(404).send({ error: 'Driver record not found' });
    const { lat, lng, routeId } = req.body as { lat: number; lng: number; routeId?: string };
    if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return reply.code(400).send({ error: 'Invalid lat/lng' });
    }

    const now = new Date();
    await db.update(drivers)
      .set({ currentLat: lat, currentLng: lng, lastPingAt: now })
      .where(eq(drivers.id, driverId));

    // Append to location history
    // P-DEL9: retentionExpiresAt = 1yr from now (driver GPS traces = patient address proximity PHI)
    const locRetention = new Date(now);
    locRetention.setFullYear(locRetention.getFullYear() + 1);
    await db.insert(driverLocationHistory).values({
      driverId,
      routeId: routeId ?? null,
      lat,
      lng,
      recordedAt: now,
      retentionExpiresAt: locRetention,
    });

    return { ok: true, recordedAt: now.toISOString() };
  });

  // PATCH /driver/me/routes/:routeId/start — driver starts their route
  app.patch('/me/routes/:routeId/start', {
    preHandler: requireRole('driver'),
  }, async (req, reply) => {
    const user = req.user as { sub: string; driverId?: string; email: string; orgId: string };
    const driverId = await resolveDriverId(user);
    if (!driverId) return reply.code(404).send({ error: 'Driver record not found' });
    const { routeId } = req.params as { routeId: string };
    const [route] = await db.select().from(routes).where(and(eq(routes.id, routeId), isNull(routes.deletedAt))).limit(1);
    if (!route || route.driverId !== driverId) return reply.code(403).send({ error: 'Forbidden' });
    const [updated] = await db.update(routes).set({ status: 'active', startedAt: new Date() }).where(eq(routes.id, routeId)).returning();

    // Fire-and-forget: notify all patients on this route that delivery is en route
    db.select().from(stops)
      .where(and(eq(stops.routeId, routeId), isNull(stops.deletedAt)))
      .then(routeStops => {
        for (const stop of routeStops) {
          sendStopNotification(stop, 'route_dispatched').catch(console.error);
        }
      })
      .catch(console.error);

    // Fire automation trigger: driver_started_route
    db.select({ orgId: plans.orgId }).from(plans)
      .where(eq(plans.id, route.planId)).limit(1)
      .then(([p]) => {
        if (p?.orgId) {
          fireTrigger({ orgId: p.orgId, trigger: 'driver_started_route', resourceId: routeId, data: { routeId, driverId } }).catch(console.error);
        }
      }).catch(console.error);

    return updated;
  });

  // POST /me/stops/:stopId/return-confirm — driver confirms package returned to pharmacy
  app.post('/me/stops/:stopId/return-confirm', { preHandler: requireRole('driver') }, async (req, reply) => {
    const jwtUser = req.user as { sub: string; driverId?: string; email: string; orgId: string };
    const driverId = await resolveDriverId(jwtUser);
    if (!driverId) return reply.code(404).send({ error: 'Driver record not found' });
    const { stopId } = req.params as { stopId: string };

    const [stop] = await db
      .select({ id: stops.id, status: stops.status, returnedAt: stops.returnedAt, routeId: stops.routeId, orgId: stops.orgId, controlledSubstance: stops.controlledSubstance, recipientName: stops.recipientName, address: stops.address })
      .from(stops)
      .where(and(eq(stops.id, stopId), eq(stops.orgId, jwtUser.orgId), isNull(stops.deletedAt)))
      .limit(1);

    if (!stop) return reply.code(404).send({ error: 'Stop not found' });
    if (stop.status !== 'failed') return reply.code(409).send({ error: 'Can only confirm return for failed stops' });
    if (stop.returnedAt) return reply.code(409).send({ error: 'Return already confirmed' });

    if (stop.routeId) {
      const [route] = await db
        .select({ driverId: routes.driverId })
        .from(routes)
        .where(eq(routes.id, stop.routeId))
        .limit(1);
      if (route?.driverId && route.driverId !== driverId) {
        return reply.code(403).send({ error: 'Not your route' });
      }
    }

    const [updated] = await db.update(stops)
      .set({ returnedAt: new Date() })
      .where(and(eq(stops.id, stopId), isNull(stops.returnedAt)))
      .returning();

    if (!updated) return reply.code(409).send({ error: 'Return already confirmed' });

    fireTrigger({
      orgId: jwtUser.orgId,
      trigger: 'stop_failed',
      resourceId: stopId,
      data: { patientName: stop.recipientName ?? '', address: stop.address ?? '', stopStatus: 'failed', controlledSubstance: String(stop.controlledSubstance ?? false) },
    }).catch(console.error);

    return { ok: true, returnedAt: updated.returnedAt };
  });

  // P-COMP8: POST /me/stops/:stopId/cod-collected — record co-pay collection at POD
  app.post('/me/stops/:stopId/cod-collected', { preHandler: requireRole('driver') }, async (req, reply) => {
    const jwtUser = req.user as { sub: string; driverId?: string; email: string; orgId: string };
    const driverId = await resolveDriverId(jwtUser);
    if (!driverId) return reply.code(404).send({ error: 'Driver record not found' });
    const { stopId } = req.params as { stopId: string };
    const { method } = req.body as { method?: string };

    const VALID_METHODS = ['cash', 'card', 'waived'] as const;
    if (!method || !VALID_METHODS.includes(method as typeof VALID_METHODS[number])) {
      return reply.code(400).send({ error: `method must be one of: ${VALID_METHODS.join(', ')}` });
    }

    const [stop] = await db
      .select({ id: stops.id, orgId: stops.orgId, codAmount: stops.codAmount, routeId: stops.routeId, codCollected: stops.codCollected })
      .from(stops)
      .where(and(eq(stops.id, stopId), eq(stops.orgId, jwtUser.orgId), isNull(stops.deletedAt)))
      .limit(1);

    if (!stop) return reply.code(404).send({ error: 'Stop not found' });
    if (!stop.codAmount) return reply.code(400).send({ error: 'This stop has no co-pay amount' });
    if (stop.codCollected) return reply.code(409).send({ error: 'Co-pay already recorded for this stop' });

    if (stop.routeId) {
      const [route] = await db.select({ driverId: routes.driverId }).from(routes)
        .where(eq(routes.id, stop.routeId)).limit(1);
      if (route?.driverId && route.driverId !== driverId) return reply.code(403).send({ error: 'Not your route' });
    }

    const [updated] = await db.update(stops)
      .set({ codCollected: true, codMethod: method, codCollectedAt: new Date() })
      .where(eq(stops.id, stopId))
      .returning({ id: stops.id, codCollected: stops.codCollected, codMethod: stops.codMethod, codCollectedAt: stops.codCollectedAt });

    return { ok: true, codMethod: updated.codMethod, codCollectedAt: updated.codCollectedAt };
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
