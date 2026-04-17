import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { depots } from '../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { requireOrgRole } from '../middleware/requireOrgRole.js';
import { geocodeAddress } from '../utils/geocode.js';

export const depotRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', {
    preHandler: requireOrgRole('pharmacy_admin', 'dispatcher', 'super_admin'),
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    return db.select().from(depots).where(and(eq(depots.orgId, orgId), isNull(depots.deletedAt)));
  });

  app.post('/', { preHandler: requireOrgRole('pharmacy_admin', 'super_admin') }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = req.body as {
      name: string; address: string; lat?: number; lng?: number; phone?: string;
    };
    const geo = await geocodeAddress(body.address);
    const lat = geo.ok ? geo.lat : (body.lat ?? 0);
    const lng = geo.ok ? geo.lng : (body.lng ?? 0);
    const [depot] = await db.insert(depots).values({ ...body, lat, lng, orgId }).returning();
    return reply.code(201).send({ ...depot, geocoded: geo.ok });
  });

  app.put('/:depotId', { preHandler: requireOrgRole('pharmacy_admin', 'super_admin') }, async (req, reply) => {
    const { orgId, depotId } = req.params as { orgId: string; depotId: string };
    const body = req.body as Partial<{ name: string; address: string; lat: number; lng: number; phone: string }>;
    const { name, address, lat, lng, phone } = body;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (phone !== undefined) updates.phone = phone;
    if (address !== undefined) {
      updates.address = address;
      const geo = await geocodeAddress(address);
      updates.lat = geo.ok ? geo.lat : (lat ?? 0);
      updates.lng = geo.ok ? geo.lng : (lng ?? 0);
    } else {
      if (lat !== undefined) updates.lat = lat;
      if (lng !== undefined) updates.lng = lng;
    }
    const [updated] = await db.update(depots).set(updates)
      .where(and(eq(depots.id, depotId), eq(depots.orgId, orgId), isNull(depots.deletedAt)))
      .returning();
    if (!updated) return reply.code(404).send({ error: 'Not found' });
    return updated;
  });

  app.post('/geocode-backfill', { preHandler: requireOrgRole('super_admin') }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const zeroDepots = await db.select().from(depots)
      .where(and(eq(depots.orgId, orgId), eq(depots.lat, 0), eq(depots.lng, 0), isNull(depots.deletedAt)));
    let fixed = 0;
    for (const depot of zeroDepots) {
      const geo = await geocodeAddress(depot.address);
      if (geo.ok) {
        await db.update(depots).set({ lat: geo.lat, lng: geo.lng }).where(eq(depots.id, depot.id));
        fixed++;
      }
    }
    return { total: zeroDepots.length, fixed };
  });

  app.delete('/:depotId', { preHandler: requireOrgRole('pharmacy_admin', 'super_admin') }, async (req, reply) => {
    const { orgId, depotId } = req.params as { orgId: string; depotId: string };
    const result = await db.update(depots).set({ deletedAt: new Date() })
      .where(and(eq(depots.id, depotId), eq(depots.orgId, orgId), isNull(depots.deletedAt)))
      .returning({ id: depots.id });
    if (result.length === 0) return reply.code(404).send({ error: 'Not found' });
    return reply.code(204).send();
  });
};
