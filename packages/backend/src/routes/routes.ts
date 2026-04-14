import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { routes, stops } from '../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';

export const routeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin', 'driver'),
  }, async (req) => {
    const { planId } = req.params as { planId: string };
    return db.select().from(routes).where(and(eq(routes.planId, planId), isNull(routes.deletedAt)));
  });

  app.post('/', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { planId } = req.params as { planId: string };
    const { driverId } = req.body as { driverId: string };
    if (!driverId) return reply.code(400).send({ error: 'driverId required' });
    const [route] = await db.insert(routes).values({ planId, driverId }).returning();
    return reply.code(201).send(route);
  });

  app.patch('/:routeId/status', {
    preHandler: requireRole('driver', 'dispatcher', 'super_admin'),
  }, async (req, reply) => {
    const { routeId } = req.params as { planId: string; routeId: string };
    const { status } = req.body as { status: 'pending' | 'active' | 'completed' };
    const updates: Record<string, unknown> = { status };
    if (status === 'active') updates.startedAt = new Date();
    if (status === 'completed') updates.completedAt = new Date();
    const [updated] = await db.update(routes).set(updates).where(eq(routes.id, routeId)).returning();
    if (!updated) return reply.code(404).send({ error: 'Not found' });
    return updated;
  });

  app.get('/:routeId/stops', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin', 'driver'),
  }, async (req) => {
    const { routeId } = req.params as { planId: string; routeId: string };
    return db
      .select()
      .from(stops)
      .where(and(eq(stops.routeId, routeId), isNull(stops.deletedAt)))
      .orderBy(stops.sequenceNumber);
  });

  app.delete('/:routeId', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { routeId } = req.params as { planId: string; routeId: string };
    await db.update(routes).set({ deletedAt: new Date() }).where(eq(routes.id, routeId));
    return reply.code(204).send();
  });
};
