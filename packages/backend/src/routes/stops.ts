import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { stops, routes, drivers } from '../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';
import { sendStopNotification, sendDriverArrivalEmail, sendRouteCompleteSummaryEmail } from '../services/notifications.js';
import { fireTrigger } from '../services/automation.js';
import type { StopStatus } from '@mydash-rx/shared';

const TERMINAL_STATUSES: StopStatus[] = ['completed', 'failed', 'rescheduled'];

async function checkAndNotifyRouteComplete(orgId: string, routeId: string): Promise<void> {
  const [route] = await db.select({ completedAt: routes.completedAt, driverId: routes.driverId })
    .from(routes).where(eq(routes.id, routeId)).limit(1);
  if (!route || route.completedAt) return; // already completed

  const routeStops = await db.select({ status: stops.status, address: stops.address })
    .from(stops).where(and(eq(stops.routeId, routeId), isNull(stops.deletedAt)));
  if (routeStops.length === 0) return;

  const allTerminal = routeStops.every(s => (TERMINAL_STATUSES as string[]).includes(s.status));
  if (!allTerminal) return;

  // Mark route complete (idempotency guard — only one concurrent caller will see completedAt = null)
  const [updated] = await db.update(routes)
    .set({ completedAt: new Date(), status: 'completed' })
    .where(and(eq(routes.id, routeId), isNull(routes.completedAt)))
    .returning({ completedAt: routes.completedAt });
  if (!updated) return; // another call already set it

  const driverName = route.driverId
    ? (await db.select({ name: drivers.name }).from(drivers).where(eq(drivers.id, route.driverId)).limit(1))[0]?.name ?? 'Driver'
    : 'Driver';

  const completedCount = routeStops.filter(s => s.status === 'completed').length;
  const failedAddresses = routeStops.filter(s => s.status === 'failed').map(s => s.address);

  await sendRouteCompleteSummaryEmail({
    orgId,
    driverName,
    completedAt: new Date(),
    totalStops: routeStops.length,
    completedCount,
    failedCount: failedAddresses.length,
    failedAddresses,
  });
}

export const stopRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'driver', 'super_admin'),
  }, async (req) => {
    const { routeId } = req.params as { routeId: string };
    return db
      .select()
      .from(stops)
      .where(and(eq(stops.routeId, routeId), isNull(stops.deletedAt)))
      .orderBy(stops.sequenceNumber);
  });

  app.post('/', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { routeId } = req.params as { routeId: string };
    const [route] = await db.select().from(routes).where(eq(routes.id, routeId)).limit(1);
    if (!route) return reply.code(404).send({ error: 'Route not found' });

    const body = req.body as {
      orgId: string;
      recipientName: string;
      recipientPhone: string;
      address: string;
      lat: number;
      lng: number;
      rxNumbers?: string[];
      packageCount?: number;
      requiresRefrigeration?: boolean;
      controlledSubstance?: boolean;
      codAmount?: number;
      requiresSignature?: boolean;
      requiresPhoto?: boolean;
      requiresAgeVerification?: boolean;
      windowStart?: string;
      windowEnd?: string;
      unit?: string;
      deliveryNotes?: string;
    };

    const [stop] = await db.insert(stops).values({
      routeId,
      orgId: body.orgId,
      recipientName: body.recipientName,
      recipientPhone: body.recipientPhone,
      address: body.address,
      lat: body.lat,
      lng: body.lng,
      rxNumbers: body.rxNumbers ?? [],
      packageCount: body.packageCount ?? 1,
      requiresRefrigeration: body.requiresRefrigeration ?? false,
      controlledSubstance: body.controlledSubstance ?? false,
      codAmount: body.codAmount,
      requiresSignature: body.requiresSignature ?? true,
      requiresPhoto: body.requiresPhoto ?? false,
      requiresAgeVerification: body.requiresAgeVerification ?? false,
      windowStart: body.windowStart ? new Date(body.windowStart) : undefined,
      windowEnd: body.windowEnd ? new Date(body.windowEnd) : undefined,
      unit: body.unit,
      deliveryNotes: body.deliveryNotes,
    }).returning();
    return reply.code(201).send(stop);
  });

  // Reorder stops within a route — PATCH /reorder
  app.patch('/reorder', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { routeId } = req.params as { routeId: string };
    const { stopIds } = req.body as { stopIds: string[] };
    if (!Array.isArray(stopIds) || stopIds.length === 0) {
      return reply.code(400).send({ error: 'stopIds must be a non-empty array' });
    }
    await Promise.all(
      stopIds.map((id, idx) =>
        db.update(stops).set({ sequenceNumber: idx }).where(and(eq(stops.id, id), eq(stops.routeId, routeId), isNull(stops.deletedAt)))
      )
    );
    await db.update(routes).set({ stopOrder: stopIds }).where(eq(routes.id, routeId));
    return { ok: true };
  });

  app.patch('/:stopId/status', {
    preHandler: requireRole('driver', 'dispatcher', 'super_admin'),
  }, async (req, reply) => {
    const { stopId } = req.params as { routeId: string; stopId: string };
    const { status, failureReason, failureNote } = req.body as {
      status: StopStatus;
      failureReason?: string;
      failureNote?: string;
    };
    const updates: Record<string, unknown> = { status };
    if (status === 'arrived') updates.arrivedAt = new Date();
    if (status === 'completed') updates.completedAt = new Date();
    if (failureReason) updates.failureReason = failureReason;
    if (failureNote) updates.failureNote = failureNote;

    const [updated] = await db.update(stops).set(updates).where(eq(stops.id, stopId)).returning();
    if (!updated) return reply.code(404).send({ error: 'Not found' });

    // Fire notifications async — don't await
    sendStopNotification(updated, status).catch(console.error);
    if (status === 'arrived') {
      sendDriverArrivalEmail(updated).catch(console.error);
    }
    if (status === 'completed' || status === 'failed') {
      checkAndNotifyRouteComplete(updated.orgId, updated.routeId).catch(console.error);
    }

    // Fire automation triggers — fire-and-forget
    fireTrigger({
      orgId: updated.orgId,
      trigger: status === 'completed' ? 'stop_completed' : status === 'failed' ? 'stop_failed' : 'stop_status_changed',
      resourceId: updated.id,
      data: {
        patientName: updated.recipientName,
        address: updated.address,
        patientPhone: updated.recipientPhone,
        stopStatus: status,
        driverName: '',
      },
    }).catch(console.error);

    return updated;
  });

  app.delete('/:stopId', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { stopId } = req.params as { routeId: string; stopId: string };
    await db.update(stops).set({ deletedAt: new Date() }).where(eq(stops.id, stopId));
    return reply.code(204).send();
  });

  // Move stop to a different route
  app.patch('/:stopId/move', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { stopId } = req.params as { routeId: string; stopId: string };
    const { targetRouteId } = req.body as { targetRouteId: string };
    if (!targetRouteId) return reply.code(400).send({ error: 'targetRouteId required' });
    const [updated] = await db.update(stops).set({ routeId: targetRouteId }).where(eq(stops.id, stopId)).returning();
    if (!updated) return reply.code(404).send({ error: 'Stop not found' });
    return updated;
  });

  // Update any stop fields (for future use)
  app.patch('/:stopId', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { stopId } = req.params as { routeId: string; stopId: string };
    const body = req.body as Record<string, unknown>;
    const allowed = ['deliveryNotes', 'packageCount', 'requiresRefrigeration', 'controlledSubstance', 'requiresSignature', 'requiresPhoto', 'codAmount'];
    const updates: Record<string, unknown> = {};
    for (const k of allowed) if (k in body) updates[k] = body[k];
    if (Object.keys(updates).length === 0) return reply.code(400).send({ error: 'No valid fields' });
    const [updated] = await db.update(stops).set(updates).where(eq(stops.id, stopId)).returning();
    if (!updated) return reply.code(404).send({ error: 'Not found' });
    return updated;
  });
};
