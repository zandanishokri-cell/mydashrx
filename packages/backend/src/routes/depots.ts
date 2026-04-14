import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { depots } from '../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';

export const depotRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', {
    preHandler: requireRole('pharmacy_admin', 'dispatcher', 'super_admin'),
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    return db.select().from(depots).where(and(eq(depots.orgId, orgId), isNull(depots.deletedAt)));
  });

  app.post('/', { preHandler: requireRole('pharmacy_admin', 'super_admin') }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = req.body as {
      name: string; address: string; lat: number; lng: number; phone?: string;
    };
    const [depot] = await db.insert(depots).values({ ...body, orgId }).returning();
    return reply.code(201).send(depot);
  });

  app.put('/:depotId', { preHandler: requireRole('pharmacy_admin', 'super_admin') }, async (req, reply) => {
    const { depotId } = req.params as { orgId: string; depotId: string };
    const body = req.body as Partial<{ name: string; address: string; lat: number; lng: number; phone: string }>;
    const [updated] = await db.update(depots).set(body).where(eq(depots.id, depotId)).returning();
    if (!updated) return reply.code(404).send({ error: 'Not found' });
    return updated;
  });

  app.delete('/:depotId', { preHandler: requireRole('pharmacy_admin', 'super_admin') }, async (req, reply) => {
    const { depotId } = req.params as { orgId: string; depotId: string };
    await db.update(depots).set({ deletedAt: new Date() }).where(eq(depots.id, depotId));
    return reply.code(204).send();
  });
};
