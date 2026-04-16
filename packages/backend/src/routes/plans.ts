import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { plans, routes, stops, depots } from '../db/schema.js';
import { eq, and, isNull, inArray, notInArray } from 'drizzle-orm';
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply.code(400).send({ error: 'date must be YYYY-MM-DD' });
    // Verify depot belongs to this org — prevents attaching a plan to a foreign depot
    const [depot] = await db.select({ id: depots.id }).from(depots)
      .where(and(eq(depots.id, depotId), eq(depots.orgId, orgId))).limit(1);
    if (!depot) return reply.code(400).send({ error: 'Invalid depotId' });
    const [plan] = await db.insert(plans).values({ orgId, depotId, date }).returning();
    return reply.code(201).send(plan);
  });

  app.patch('/:planId/distribute', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId, planId } = req.params as { orgId: string; planId: string };

    // Verify plan exists, belongs to org, and has at least one route before distributing
    const [plan] = await db.select().from(plans)
      .where(and(eq(plans.id, planId), eq(plans.orgId, orgId), isNull(plans.deletedAt)))
      .limit(1);
    if (!plan) return reply.code(404).send({ error: 'Not found' });

    const planRouteList = await db.select({ id: routes.id })
      .from(routes).where(and(eq(routes.planId, planId), isNull(routes.deletedAt)));
    if (planRouteList.length === 0) return reply.code(400).send({ error: 'Cannot distribute a plan with no routes' });

    // Idempotent: already distributed is a no-op
    if (plan.status === 'distributed') return plan;

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

    // Block optimization on already-distributed or completed plans
    if (plan.status === 'distributed' || plan.status === 'completed') {
      return reply.code(409).send({ error: `Cannot optimize a plan with status '${plan.status}'` });
    }

    const [depot] = await db.select().from(depots).where(eq(depots.id, plan.depotId)).limit(1);
    if (!depot) return reply.code(404).send({ error: 'Depot not found' });

    // Guard: depot must have valid coordinates for optimizer
    if (!depot.lat || !depot.lng) return reply.code(422).send({ error: 'Depot is missing GPS coordinates — cannot optimize' });

    const planRoutes = await db.select().from(routes).where(and(eq(routes.planId, planId), isNull(routes.deletedAt)));
    if (planRoutes.length === 0) return reply.code(400).send({ error: 'No routes to optimize' });

    const results = await Promise.all(
      planRoutes.map(async (route) => {
        const routeStops = await db
          .select()
          .from(stops)
          .where(and(
            eq(stops.routeId, route.id),
            isNull(stops.deletedAt),
            // Exclude already-terminal stops from re-optimization
            notInArray(stops.status, ['completed', 'failed', 'rescheduled']),
          ));
        // Filter out stops with missing geocoding (lat=0,lng=0 → pre-geocoding-fix data)
        const geocodedStops = routeStops.filter(s => s.lat !== 0 || s.lng !== 0);
        if (geocodedStops.length === 0) return null;

        const originalOrder = [...(route.stopOrder as string[])];
        const optimized = await optimizeRoute(depot.lat, depot.lng, geocodedStops);
        // Use real route duration from optimizer (minutes→seconds); fall back to 8 min/stop estimate
        const estimatedDuration = optimized.totalDuration > 0
          ? Math.round(optimized.totalDuration * 60)
          : optimized.stopIds.length * 8 * 60;

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
    // Only mark optimized if at least one route was actually processed
    if (optimizedResults.length > 0) {
      await db.update(plans).set({ status: 'optimized' }).where(eq(plans.id, planId));
    }
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
