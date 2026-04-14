import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { organizations } from '../db/schema.js';
import { eq, isNull } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';

export const organizationRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: requireRole('super_admin') }, async () =>
    db.select().from(organizations).where(isNull(organizations.deletedAt)),
  );

  app.get('/:orgId', {
    preHandler: requireRole('super_admin', 'pharmacy_admin', 'dispatcher'),
  }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const user = req.user as { orgId: string; role: string };
    if (user.role !== 'super_admin' && user.orgId !== orgId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return reply.code(404).send({ error: 'Not found' });
    return org;
  });

  app.post('/', { preHandler: requireRole('super_admin') }, async (req, reply) => {
    const body = req.body as { name: string; timezone?: string };
    if (!body.name) return reply.code(400).send({ error: 'name required' });
    const [org] = await db
      .insert(organizations)
      .values({ name: body.name, timezone: body.timezone ?? 'America/New_York' })
      .returning();
    return reply.code(201).send(org);
  });

  app.patch('/:orgId', { preHandler: requireRole('super_admin', 'pharmacy_admin') }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = req.body as Partial<{ name: string; timezone: string }>;
    const [updated] = await db
      .update(organizations)
      .set(body)
      .where(eq(organizations.id, orgId))
      .returning();
    if (!updated) return reply.code(404).send({ error: 'Not found' });
    return updated;
  });
};
