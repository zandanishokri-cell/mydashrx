import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { routes, stops, plans, drivers } from '../db/schema.js';
import { eq, and, isNull, inArray, notInArray } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';

export const routeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin', 'driver'),
  }, async (req, reply) => {
    const { planId } = req.params as { planId: string };
    const { orgId: userOrgId, role, depotIds } = req.user as { orgId: string; role: string; depotIds: string[] };
    const [plan] = await db.select({ orgId: plans.orgId, depotId: plans.depotId }).from(plans)
      .where(and(eq(plans.id, planId), isNull(plans.deletedAt))).limit(1);
    if (!plan || plan.orgId !== userOrgId) return reply.code(403).send({ error: 'Forbidden' });
    if (role === 'dispatcher' && depotIds?.length > 0 && !depotIds.includes(plan.depotId)) {
      return reply.code(403).send({ error: 'Access denied to this depot' });
    }
    return db.select().from(routes).where(and(eq(routes.planId, planId), isNull(routes.deletedAt)));
  });

  app.post('/', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { planId } = req.params as { planId: string };
    const { orgId: userOrgId } = req.user as { orgId: string };
    // Verify plan belongs to this org before allowing route creation
    const [plan] = await db.select({ orgId: plans.orgId }).from(plans)
      .where(and(eq(plans.id, planId), isNull(plans.deletedAt))).limit(1);
    if (!plan || plan.orgId !== userOrgId) return reply.code(403).send({ error: 'Forbidden' });
    const { driverId } = req.body as { driverId: string };
    if (!driverId) return reply.code(400).send({ error: 'driverId required' });
    // Verify driver belongs to same org — prevents attaching a foreign-org driver to this plan
    const [driver] = await db.select({ id: drivers.id }).from(drivers)
      .where(and(eq(drivers.id, driverId), eq(drivers.orgId, userOrgId), isNull(drivers.deletedAt))).limit(1);
    if (!driver) return reply.code(400).send({ error: 'Invalid driverId' });
    const [route] = await db.insert(routes).values({ planId, driverId }).returning();
    return reply.code(201).send(route);
  });

  app.patch('/:routeId/status', {
    preHandler: requireRole('driver', 'dispatcher', 'super_admin'),
  }, async (req, reply) => {
    const { planId, routeId } = req.params as { planId: string; routeId: string };
    const { orgId: userOrgId } = req.user as { orgId: string };
    // Verify plan belongs to this org before allowing status mutation
    const [plan] = await db.select({ orgId: plans.orgId }).from(plans)
      .where(and(eq(plans.id, planId), isNull(plans.deletedAt))).limit(1);
    if (!plan || plan.orgId !== userOrgId) return reply.code(403).send({ error: 'Forbidden' });
    const { status } = req.body as { status: string };
    const VALID_STATUSES = ['pending', 'active', 'completed'] as const;
    if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
      return reply.code(400).send({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }
    const updates: Record<string, unknown> = { status };
    if (status === 'active') updates.startedAt = new Date();
    if (status === 'completed') updates.completedAt = new Date();
    const [updated] = await db.update(routes).set(updates)
      .where(and(eq(routes.id, routeId), eq(routes.planId, planId)))
      .returning();
    if (!updated) return reply.code(404).send({ error: 'Not found' });
    return updated;
  });

  app.get('/:routeId/stops', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin', 'driver'),
  }, async (req, reply) => {
    const { routeId } = req.params as { planId: string; routeId: string };
    const { orgId: userOrgId, role, driverId } = req.user as { orgId: string; role: string; driverId?: string };
    // Drivers may only fetch stops for their own assigned route
    if (role === 'driver') {
      const [route] = await db.select({ driverId: routes.driverId }).from(routes)
        .where(and(eq(routes.id, routeId), isNull(routes.deletedAt))).limit(1);
      if (!route || route.driverId !== driverId) return reply.code(403).send({ error: 'Forbidden' });
    }
    return db
      .select()
      .from(stops)
      .where(and(eq(stops.routeId, routeId), eq(stops.orgId, userOrgId), isNull(stops.deletedAt)))
      .orderBy(stops.sequenceNumber);
  });

  app.delete('/:routeId', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { planId, routeId } = req.params as { planId: string; routeId: string };
    const { orgId: userOrgId } = req.user as { orgId: string };
    // Verify plan belongs to this org before allowing route deletion
    const [plan] = await db.select({ orgId: plans.orgId }).from(plans)
      .where(and(eq(plans.id, planId), isNull(plans.deletedAt))).limit(1);
    if (!plan || plan.orgId !== userOrgId) return reply.code(403).send({ error: 'Forbidden' });
    // Unassign only non-terminal stops — terminal stops (completed/failed/rescheduled)
    // must remain linked to the route for audit/history. Non-terminal stops return to
    // the "Unassigned" pool so they can be re-routed.
    await db.update(stops)
      .set({ routeId: null })
      .where(and(
        eq(stops.routeId, routeId),
        isNull(stops.deletedAt),
        notInArray(stops.status, ['completed', 'failed', 'rescheduled']),
      ));
    await db.update(routes).set({ deletedAt: new Date() })
      .where(and(eq(routes.id, routeId), eq(routes.planId, planId)));
    return reply.code(204).send();
  });
};
