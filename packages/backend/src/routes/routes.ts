import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { routes, stops, plans, drivers, organizations, users, adminAuditLogs } from '../db/schema.js';
import { eq, and, isNull, inArray, notInArray, or } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';
import { sendAhaMomentEmail } from '../lib/emailHelpers.js';
import { decryptStopRow } from './stops.js'; // P-SEC40: decrypt PHI before returning stop rows

export const routeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin', 'driver'),
  }, async (req, reply) => {
    const { planId } = req.params as { planId: string };
    const { orgId: userOrgId, role, depotIds, sub } = req.user as { orgId: string; role: string; depotIds: string[]; sub: string };
    const [plan] = await db.select({ orgId: plans.orgId, depotId: plans.depotId }).from(plans)
      .where(and(eq(plans.id, planId), isNull(plans.deletedAt))).limit(1);
    if (!plan || plan.orgId !== userOrgId) return reply.code(403).send({ error: 'Forbidden' });
    if (role === 'dispatcher') {
      if (!depotIds?.length || !depotIds.includes(plan.depotId)) {
        return reply.code(403).send({ error: 'Access denied' });
      }
    }

    // P-RBAC14: dispatcher resource scoping — dispatchers only see routes assigned to them + unassigned
    // HIPAA §164.502(b) minimum-necessary: multi-team chains must not see all org routes
    if (role === 'dispatcher') {
      return db.select().from(routes).where(and(
        eq(routes.planId, planId),
        isNull(routes.deletedAt),
        or(eq(routes.assignedDispatcherId, sub), isNull(routes.assignedDispatcherId)),
      ));
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

    // P-ONB38/P-ONB37: set firstDispatchAt + activatedAt on first route dispatch (idempotent)
    // P-CNV28: aha-moment email on first dispatch — fire-and-forget
    // P-CNV29: lastDispatchedAt updated on every dispatch
    if (status === 'active') {
      const now = new Date();
      // P-CNV29: always update lastDispatchedAt
      db.update(organizations)
        .set({ lastDispatchedAt: now })
        .where(eq(organizations.id, userOrgId))
        .catch(console.error);
      // P-ONB38: set firstDispatchAt + activatedAt once (idempotent)
      // P-CNV28: also set firstDispatchedAt (dedicated column for aha-moment tracking)
      db.update(organizations)
        .set({ firstDispatchAt: now, activatedAt: now, firstDispatchedAt: now })
        .where(and(eq(organizations.id, userOrgId), isNull(organizations.firstDispatchAt)))
        .then(async () => {
          // P-CNV28: fire aha-moment email on first dispatch — lookup pharmacy_admin email
          try {
            const [admin] = await db.select({ userId: users.id, email: users.email, name: users.name, orgName: organizations.name })
              .from(users)
              .innerJoin(organizations, eq(organizations.id, users.orgId))
              .where(and(eq(users.orgId, userOrgId), eq(users.role, 'pharmacy_admin'), isNull(users.deletedAt)))
              .limit(1);
            if (admin && admin.userId) {
              sendAhaMomentEmail(userOrgId, admin.email, admin.orgName).catch(console.error);
              // Audit log aha_moment_email_sent — HIPAA §164.312(b)
              db.insert(adminAuditLogs).values({
                actorId: admin.userId,
                actorEmail: admin.email,
                action: 'aha_moment_email_sent',
                targetId: userOrgId,
                targetName: admin.orgName,
                metadata: { orgId: userOrgId, adminEmail: admin.email },
              }).catch(console.error);
            }
          } catch { /* fire-and-forget — never block dispatch */ }
        })
        .catch(console.error);
    }

    return updated;
  });

  // P-RBAC14: PATCH /:routeId/assign-dispatcher — pharmacy_admin/super_admin only
  // Assigns a dispatcher to a route so they can see it in their scoped view
  app.patch('/:routeId/assign-dispatcher', {
    preHandler: requireRole('pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { planId, routeId } = req.params as { planId: string; routeId: string };
    const { orgId: userOrgId } = req.user as { orgId: string };
    const { dispatcherId } = req.body as { dispatcherId: string | null };

    // Verify plan org
    const [plan] = await db.select({ orgId: plans.orgId }).from(plans)
      .where(and(eq(plans.id, planId), isNull(plans.deletedAt))).limit(1);
    if (!plan || plan.orgId !== userOrgId) return reply.code(403).send({ error: 'Forbidden' });

    // If assigning (not clearing), verify dispatcher belongs to same org with dispatcher role
    if (dispatcherId) {
      const [dispatcher] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.id, dispatcherId), eq(users.orgId, userOrgId), eq(users.role, 'dispatcher'), isNull(users.deletedAt))).limit(1);
      if (!dispatcher) return reply.code(400).send({ error: 'Invalid dispatcherId — must be a dispatcher in this org' });
    }

    const [updated] = await db.update(routes)
      .set({ assignedDispatcherId: dispatcherId ?? null })
      .where(and(eq(routes.id, routeId), eq(routes.planId, planId), isNull(routes.deletedAt)))
      .returning();
    if (!updated) return reply.code(404).send({ error: 'Route not found' });

    // Audit log — HIPAA §164.308(a)(4)(ii)(B)
    const actor = req.user as { sub: string; email: string };
    db.insert(adminAuditLogs).values({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'dispatcher_assigned_to_route',
      targetId: routeId,
      targetName: `route:${routeId}`,
      metadata: { routeId, planId, dispatcherId: dispatcherId ?? null, orgId: userOrgId },
    }).catch(console.error);

    return { ok: true, routeId, assignedDispatcherId: updated.assignedDispatcherId };
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
    const raw = await db
      .select()
      .from(stops)
      .where(and(eq(stops.routeId, routeId), eq(stops.orgId, userOrgId), isNull(stops.deletedAt)))
      .orderBy(stops.sequenceNumber);
    return (raw as Record<string, unknown>[]).map(decryptStopRow);
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
