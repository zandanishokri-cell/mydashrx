import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { stops, routes, drivers, plans } from '../db/schema.js';
import { eq, and, isNull, inArray, notInArray } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';
import { sendStopNotification, sendDriverArrivalEmail, sendRouteCompleteSummaryEmail } from '../services/notifications.js';
import { fireTrigger } from '../services/automation.js';
import { TERMINAL_STATUSES, type StopStatus } from '@mydash-rx/shared';
import { ETA_PER_STOP_MS } from './tracking.js';

export async function checkAndNotifyRouteComplete(orgId: string, routeId: string): Promise<void> {
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

  // Fire automation trigger: route_completed
  fireTrigger({
    orgId,
    trigger: 'route_completed',
    resourceId: routeId,
    data: { routeId, driverName, completedCount, totalStops: routeStops.length, failedCount: failedAddresses.length },
  }).catch(console.error);
}

const APPROACH_THRESHOLD = 3; // fire SMS when driver is ≤ this many stops ahead

async function fireApproachNotifications(orgId: string, routeId: string): Promise<void> {
  const [route] = await db
    .select({ stopOrder: routes.stopOrder })
    .from(routes)
    .where(eq(routes.id, routeId))
    .limit(1);
  if (!route?.stopOrder) return;

  const stopOrder = route.stopOrder as string[];

  // Fetch ALL non-terminal stops (including already-notified) to build the active queue
  const allActive = await db
    .select({ id: stops.id, status: stops.status })
    .from(stops)
    .where(and(
      eq(stops.routeId, routeId),
      eq(stops.orgId, orgId),
      isNull(stops.deletedAt),
    ));

  const nonTerminalIds = new Set(
    allActive
      .filter(s => !(TERMINAL_STATUSES as string[]).includes(s.status ?? ''))
      .map(s => s.id),
  );

  // Active queue: stopOrder filtered to only non-terminal stops preserves relative sequence
  const activeOrder = stopOrder.filter(id => nonTerminalIds.has(id));

  const pending = await db
    .select({
      id: stops.id,
      orgId: stops.orgId,
      recipientPhone: stops.recipientPhone,
      trackingToken: stops.trackingToken,
      routeId: stops.routeId,
      status: stops.status,
    })
    .from(stops)
    .where(and(
      eq(stops.routeId, routeId),
      eq(stops.orgId, orgId),
      isNull(stops.deletedAt),
      isNull(stops.approachNotifiedAt),
    ));

  for (const stop of pending) {
    if ((TERMINAL_STATUSES as string[]).includes(stop.status ?? '')) continue;
    // Use relative position in active queue — not absolute index in full stopOrder
    const stopsAhead = activeOrder.indexOf(stop.id);
    if (stopsAhead <= 0 || stopsAhead > APPROACH_THRESHOLD) continue;

    const etaMin = Math.round(stopsAhead * ETA_PER_STOP_MS / 60000);

    // Mark notified before sending — prevents duplicate if Twilio is slow
    await db.update(stops)
      .set({ approachNotifiedAt: new Date() })
      .where(and(eq(stops.id, stop.id), isNull(stops.approachNotifiedAt)));

    sendStopNotification(stop, 'stop_approaching', {
      stopsAway: String(stopsAhead),
      etaMin: String(etaMin),
    }).catch(console.error);
  }
}

export const stopRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'driver', 'super_admin'),
  }, async (req) => {
    const { routeId } = req.params as { routeId: string };
    const { orgId: userOrgId, role, depotIds } = req.user as { orgId: string; role: string; depotIds: string[] };
    if (role === 'dispatcher' && (depotIds as string[])?.length > 0) {
      const [routePlan] = await db
        .select({ depotId: plans.depotId })
        .from(routes)
        .innerJoin(plans, eq(routes.planId, plans.id))
        .where(eq(routes.id, routeId))
        .limit(1);
      if (!routePlan || !(depotIds as string[]).includes(routePlan.depotId)) return [];
    }
    return db
      .select()
      .from(stops)
      .where(and(eq(stops.routeId, routeId), eq(stops.orgId, userOrgId), isNull(stops.deletedAt)))
      .orderBy(stops.sequenceNumber);
  });

  app.post('/', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { routeId } = req.params as { routeId: string };
    const { orgId: userOrgId } = req.user as { orgId: string };
    // Verify route belongs to caller's org before allowing stop creation
    const [route] = await db
      .select({ id: routes.id })
      .from(routes)
      .innerJoin(plans, and(eq(routes.planId, plans.id), eq(plans.orgId, userOrgId), isNull(plans.deletedAt)))
      .where(and(eq(routes.id, routeId), isNull(routes.deletedAt)))
      .limit(1);
    if (!route) return reply.code(404).send({ error: 'Route not found' });

    const body = req.body as {
      recipientName: string;
      recipientPhone: string;
      recipientEmail?: string;
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
      orgId: userOrgId,
      recipientName: body.recipientName,
      recipientPhone: body.recipientPhone,
      recipientEmail: body.recipientEmail,
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
    const { orgId: userOrgId } = req.user as { orgId: string };
    const { stopIds } = req.body as { stopIds: string[] };
    if (!Array.isArray(stopIds) || stopIds.length === 0) {
      return reply.code(400).send({ error: 'stopIds must be a non-empty array' });
    }
    // Verify route belongs to caller's org before allowing reorder
    const [route] = await db
      .select({ id: routes.id })
      .from(routes)
      .innerJoin(plans, and(eq(routes.planId, plans.id), eq(plans.orgId, userOrgId), isNull(plans.deletedAt)))
      .where(and(eq(routes.id, routeId), isNull(routes.deletedAt)))
      .limit(1);
    if (!route) return reply.code(404).send({ error: 'Route not found' });

    await Promise.all(
      stopIds.map((id, idx) =>
        db.update(stops).set({ sequenceNumber: idx }).where(and(eq(stops.id, id), eq(stops.routeId, routeId), isNull(stops.deletedAt)))
      )
    );

    // Count non-terminal stops to compute updated ETA
    const routeStops = await db
      .select({ status: stops.status })
      .from(stops)
      .where(and(eq(stops.routeId, routeId), isNull(stops.deletedAt)));
    const activeStopCount = routeStops.filter(s => !(TERMINAL_STATUSES as string[]).includes(s.status)).length;
    const estimatedDuration = activeStopCount * 8 * 60; // seconds, 8 min/stop

    await db.update(routes).set({ stopOrder: stopIds, estimatedDuration }).where(eq(routes.id, routeId));
    return { stopOrder: stopIds, estimatedDuration, activeStopCount };
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

    // Guard: block updates on terminal stops (prevents resurrecting completed/failed stops)
    const { orgId: userOrgId } = req.user as { orgId: string };
    const [existing] = await db
      .select({ status: stops.status, orgId: stops.orgId })
      .from(stops)
      .where(and(eq(stops.id, stopId), eq(stops.orgId, userOrgId), isNull(stops.deletedAt)))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    if ((TERMINAL_STATUSES as string[]).includes(existing.status)) {
      return reply.code(409).send({ error: `Cannot update a stop in terminal status: ${existing.status}` });
    }

    const updates: Record<string, unknown> = { status };
    if (status === 'arrived') updates.arrivedAt = new Date();
    if (status === 'completed' || status === 'failed') updates.completedAt = new Date();
    if (failureReason) updates.failureReason = failureReason;
    if (failureNote) updates.failureNote = failureNote;

    const [updated] = await db.update(stops).set(updates).where(eq(stops.id, stopId)).returning();
    if (!updated) return reply.code(404).send({ error: 'Not found' });

    // Fire notifications async — don't await
    sendStopNotification(updated, status).catch(console.error);
    if (status === 'arrived') {
      sendDriverArrivalEmail(updated).catch(console.error);
    }
    if ((status === 'completed' || status === 'failed' || status === 'rescheduled') && updated.routeId) {
      checkAndNotifyRouteComplete(updated.orgId, updated.routeId).catch(console.error);
    }
    // Auto-notify patients approaching their delivery window when driver advances
    if ((status === 'completed' || status === 'arrived') && updated.routeId) {
      fireApproachNotifications(updated.orgId, updated.routeId).catch(console.error);
    }

    // Fire automation triggers — fire-and-forget
    (async () => {
      let driverName = '';
      if (updated.routeId) {
        const [r] = await db.select({ driverId: routes.driverId }).from(routes).where(eq(routes.id, updated.routeId)).limit(1);
        if (r?.driverId) {
          const [d] = await db.select({ name: drivers.name }).from(drivers).where(eq(drivers.id, r.driverId)).limit(1);
          driverName = d?.name ?? '';
        }
      }
      await fireTrigger({
        orgId: updated.orgId,
        trigger: status === 'completed' ? 'stop_completed' : status === 'failed' ? 'stop_failed' : 'stop_status_changed',
        resourceId: updated.id,
        data: {
          patientName: updated.recipientName,
          patientPhone: updated.recipientPhone,
          patientEmail: updated.recipientEmail ?? '',
          address: updated.address,
          stopStatus: status,
          driverName,
        },
      });
    })().catch(console.error);

    return updated;
  });

  app.delete('/:stopId', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { routeId, stopId } = req.params as { routeId: string; stopId: string };
    // Scope delete to the route to prevent cross-org/cross-route deletion
    const result = await db.update(stops)
      .set({ deletedAt: new Date() })
      .where(and(eq(stops.id, stopId), eq(stops.routeId, routeId), isNull(stops.deletedAt)))
      .returning({ id: stops.id });
    if (result.length === 0) return reply.code(404).send({ error: 'Stop not found' });
    return reply.code(204).send();
  });

  // Move stop to a different route
  app.patch('/:stopId/move', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { routeId, stopId } = req.params as { routeId: string; stopId: string };
    const { orgId: userOrgId } = req.user as { orgId: string };
    const { targetRouteId } = req.body as { targetRouteId: string };
    if (!targetRouteId) return reply.code(400).send({ error: 'targetRouteId required' });
    // Verify target route belongs to caller's org before allowing cross-route move
    const [targetRoute] = await db
      .select({ id: routes.id })
      .from(routes)
      .innerJoin(plans, and(eq(routes.planId, plans.id), eq(plans.orgId, userOrgId), isNull(plans.deletedAt)))
      .where(and(eq(routes.id, targetRouteId), isNull(routes.deletedAt)))
      .limit(1);
    if (!targetRoute) return reply.code(404).send({ error: 'Target route not found' });
    // Scope to the originating route to prevent cross-org moves
    const [updated] = await db.update(stops)
      .set({ routeId: targetRouteId })
      .where(and(eq(stops.id, stopId), eq(stops.routeId, routeId), eq(stops.orgId, userOrgId), isNull(stops.deletedAt)))
      .returning();
    if (!updated) return reply.code(404).send({ error: 'Stop not found' });
    return updated;
  });

  // Bulk move stops to a different route
  app.post('/bulk-move', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { routeId } = req.params as { routeId: string };
    const { orgId: userOrgId } = req.user as { orgId: string };
    const { stopIds, targetRouteId } = req.body as { stopIds: string[]; targetRouteId: string };
    if (!Array.isArray(stopIds) || stopIds.length === 0) return reply.code(400).send({ error: 'stopIds must be a non-empty array' });
    if (!targetRouteId) return reply.code(400).send({ error: 'targetRouteId required' });
    // Verify both source and target routes belong to caller's org
    const [targetRoute] = await db
      .select({ id: routes.id })
      .from(routes)
      .innerJoin(plans, and(eq(routes.planId, plans.id), eq(plans.orgId, userOrgId), isNull(plans.deletedAt)))
      .where(and(eq(routes.id, targetRouteId), isNull(routes.deletedAt)))
      .limit(1);
    if (!targetRoute) return reply.code(404).send({ error: 'Target route not found' });
    // Skip terminal stops — they must stay on their route for audit history
    const TERMINAL = ['completed', 'failed', 'rescheduled'] as const;
    const result = await db.update(stops)
      .set({ routeId: targetRouteId, sequenceNumber: 0 })
      .where(and(
        inArray(stops.id, stopIds),
        eq(stops.routeId, routeId),
        eq(stops.orgId, userOrgId),
        isNull(stops.deletedAt),
        notInArray(stops.status, [...TERMINAL]),
      ))
      .returning({ id: stops.id });
    const moved = result.length;
    const skipped = stopIds.length - moved;
    return { moved, skipped };
  });

  // Update any stop fields (for future use)
  app.patch('/:stopId', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { routeId, stopId } = req.params as { routeId: string; stopId: string };
    const { orgId: userOrgId } = req.user as { orgId: string };
    const body = req.body as Record<string, unknown>;
    const allowed = ['deliveryNotes', 'packageCount', 'requiresRefrigeration', 'controlledSubstance', 'requiresSignature', 'requiresPhoto', 'codAmount'];
    const updates: Record<string, unknown> = {};
    for (const k of allowed) if (k in body) updates[k] = body[k];
    if (Object.keys(updates).length === 0) return reply.code(400).send({ error: 'No valid fields' });
    // Scope to route AND org to prevent cross-org edits
    const [updated] = await db.update(stops)
      .set(updates)
      .where(and(eq(stops.id, stopId), eq(stops.routeId, routeId), eq(stops.orgId, userOrgId), isNull(stops.deletedAt)))
      .returning();
    if (!updated) return reply.code(404).send({ error: 'Not found' });
    return updated;
  });
};
