import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { plans, routes, stops, depots } from '../db/schema.js';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';
import { optimizeRoute } from '../services/routeOptimizer.js';

export const planRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', {
    preHandler: requireRole('pharmacy_admin', 'dispatcher', 'super_admin'),
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const { date, depotId } = req.query as { date?: string; depotId?: string };
    const conditions = [eq(plans.orgId, orgId), isNull(plans.deletedAt)];
    if (date) conditions.push(eq(plans.date, date));
    if (depotId) conditions.push(eq(plans.depotId, depotId));
    return db.select().from(plans).where(and(...conditions)).orderBy(plans.date);
  });

  app.get('/:planId', {
    preHandler: requireRole('pharmacy_admin', 'dispatcher', 'super_admin'),
  }, async (req, reply) => {
    const { orgId, planId } = req.params as { orgId: string; planId: string };
    const [plan] = await db.select().from(plans)
      .where(and(eq(plans.id, planId), eq(plans.orgId, orgId), isNull(plans.deletedAt)))
      .limit(1);
    if (!plan) return reply.code(404).send({ error: 'Not found' });
    const planRoutes = await db.select().from(routes).where(and(eq(routes.planId, planId), isNull(routes.deletedAt)));
    return { ...plan, routes: planRoutes };
  });

  app.post('/', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const { depotId, date } = req.body as { depotId: string; date: string };
    if (!depotId || !date) return reply.code(400).send({ error: 'depotId and date required' });
    const [plan] = await db.insert(plans).values({ orgId, depotId, date }).returning();
    return reply.code(201).send(plan);
  });

  app.patch('/:planId/distribute', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId, planId } = req.params as { orgId: string; planId: string };
    const [updated] = await db
      .update(plans)
      .set({ status: 'distributed' })
      .where(and(eq(plans.id, planId), eq(plans.orgId, orgId), isNull(plans.deletedAt)))
      .returning();
    if (!updated) return reply.code(404).send({ error: 'Not found' });
    return updated;
  });

  app.post('/:planId/optimize', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId, planId } = req.params as { orgId: string; planId: string };

    const [plan] = await db.select().from(plans)
      .where(and(eq(plans.id, planId), eq(plans.orgId, orgId), isNull(plans.deletedAt)))
      .limit(1);
    if (!plan) return reply.code(404).send({ error: 'Plan not found' });

    const [depot] = await db.select().from(depots).where(eq(depots.id, plan.depotId)).limit(1);
    if (!depot) return reply.code(404).send({ error: 'Depot not found' });

    const planRoutes = await db.select().from(routes).where(and(eq(routes.planId, planId), isNull(routes.deletedAt)));

    const results = await Promise.all(
      planRoutes.map(async (route) => {
        const routeStops = await db
          .select()
          .from(stops)
          .where(and(eq(stops.routeId, route.id), isNull(stops.deletedAt)));
        if (routeStops.length === 0) return null;

        const originalOrder = [...(route.stopOrder as string[])];
        const optimized = await optimizeRoute(depot.lat, depot.lng, routeStops);
        const estimatedDuration = optimized.stopIds.length * 8 * 60; // 8 min/stop in seconds

        await db.update(routes).set({
          stopOrder: optimized.stopIds,
          estimatedDuration,
          totalDistance: optimized.totalDistance,
        }).where(eq(routes.id, route.id));

        await Promise.all(
          optimized.stopIds.map((stopId, i) =>
            db.update(stops).set({ sequenceNumber: i }).where(eq(stops.id, stopId)),
          ),
        );

        return { routeId: route.id, originalOrder, newOrder: optimized.stopIds, estimatedDuration };
      }),
    );

    const optimizedResults = results.filter(Boolean) as { routeId: string; originalOrder: string[]; newOrder: string[]; estimatedDuration: number }[];
    await db.update(plans).set({ status: 'optimized' }).where(eq(plans.id, planId));
    return { optimized: optimizedResults.length, routes: optimizedResults };
  });

  app.delete('/:planId', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId, planId } = req.params as { orgId: string; planId: string };
    // Verify ownership before cascade
    const [plan] = await db.select({ id: plans.id }).from(plans)
      .where(and(eq(plans.id, planId), eq(plans.orgId, orgId), isNull(plans.deletedAt))).limit(1);
    if (!plan) return reply.code(404).send({ error: 'Not found' });

    // Cascade: unassign stops + soft-delete routes before deleting plan
    const planRoutes = await db.select({ id: routes.id })
      .from(routes).where(and(eq(routes.planId, planId), isNull(routes.deletedAt)));
    if (planRoutes.length > 0) {
      const routeIds = planRoutes.map(r => r.id);
      await db.update(stops).set({ routeId: null })
        .where(and(inArray(stops.routeId, routeIds), isNull(stops.deletedAt)));
      await db.update(routes).set({ deletedAt: new Date() })
        .where(inArray(routes.id, routeIds));
    }
    await db.update(plans).set({ deletedAt: new Date() }).where(eq(plans.id, planId));
    return reply.code(204).send();
  });
};
