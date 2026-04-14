import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { drivers, stops, routes, plans } from '../db/schema.js';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';
import { hashPassword } from '../services/auth.js';

export const driverRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', {
    preHandler: requireRole('pharmacy_admin', 'dispatcher', 'super_admin'),
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    // Include total stop count (all time) and today's stop count
    const today = new Date().toISOString().split('T')[0];
    const rows = await db
      .select({
        id: drivers.id, orgId: drivers.orgId, name: drivers.name,
        email: drivers.email, phone: drivers.phone,
        drugCapable: drivers.drugCapable, vehicleType: drivers.vehicleType,
        status: drivers.status, currentLat: drivers.currentLat,
        currentLng: drivers.currentLng, lastPingAt: drivers.lastPingAt,
        totalStops: sql<number>`count(distinct ${stops.id})::int`,
      })
      .from(drivers)
      .leftJoin(routes, eq(routes.driverId, drivers.id))
      .leftJoin(stops, and(eq(stops.routeId, routes.id), isNull(stops.deletedAt)))
      .where(and(eq(drivers.orgId, orgId), isNull(drivers.deletedAt)))
      .groupBy(drivers.id);
    return rows;
  });

  app.get('/:driverId', {
    preHandler: requireRole('pharmacy_admin', 'dispatcher', 'super_admin', 'driver'),
  }, async (req, reply) => {
    const { driverId } = req.params as { orgId: string; driverId: string };
    const [driver] = await db
      .select({
        id: drivers.id, orgId: drivers.orgId, name: drivers.name,
        email: drivers.email, phone: drivers.phone,
        drugCapable: drivers.drugCapable, vehicleType: drivers.vehicleType,
        status: drivers.status, currentLat: drivers.currentLat,
        currentLng: drivers.currentLng, lastPingAt: drivers.lastPingAt,
      })
      .from(drivers)
      .where(eq(drivers.id, driverId))
      .limit(1);
    if (!driver) return reply.code(404).send({ error: 'Not found' });
    return driver;
  });

  app.post('/', { preHandler: requireRole('pharmacy_admin', 'super_admin') }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = req.body as {
      name: string; email: string; phone: string; password: string;
      drugCapable?: boolean; vehicleType?: 'car' | 'van' | 'bicycle';
    };
    const passwordHash = await hashPassword(body.password);
    const [driver] = await db.insert(drivers).values({
      orgId, name: body.name, email: body.email, phone: body.phone,
      passwordHash, drugCapable: body.drugCapable ?? false,
      vehicleType: body.vehicleType ?? 'car',
    }).returning();
    const { passwordHash: _, ...safe } = driver;
    return reply.code(201).send(safe);
  });

  // GPS ping from driver app
  app.post('/:driverId/ping', { preHandler: requireRole('driver', 'super_admin') }, async (req, reply) => {
    const { driverId } = req.params as { orgId: string; driverId: string };
    const { lat, lng } = req.body as { lat: number; lng: number };
    await db.update(drivers).set({
      currentLat: lat, currentLng: lng, lastPingAt: new Date(), status: 'on_route',
    }).where(eq(drivers.id, driverId));
    return { ok: true };
  });

  app.patch('/:driverId/status', { preHandler: requireRole('driver', 'dispatcher', 'super_admin') }, async (req, reply) => {
    const { driverId } = req.params as { orgId: string; driverId: string };
    const { status } = req.body as { status: 'available' | 'on_route' | 'offline' };
    const [updated] = await db.update(drivers).set({ status }).where(eq(drivers.id, driverId)).returning();
    if (!updated) return reply.code(404).send({ error: 'Not found' });
    return { id: updated.id, status: updated.status };
  });

  app.patch('/:driverId', { preHandler: requireRole('pharmacy_admin', 'dispatcher', 'super_admin') }, async (req, reply) => {
    const { driverId } = req.params as { orgId: string; driverId: string };
    const body = req.body as { name?: string; phone?: string; vehicleType?: 'car' | 'van' | 'bicycle'; drugCapable?: boolean };
    const [updated] = await db.update(drivers).set(body).where(eq(drivers.id, driverId)).returning();
    if (!updated) return reply.code(404).send({ error: 'Not found' });
    const { passwordHash: _, ...safe } = updated;
    return safe;
  });

  app.delete('/:driverId', { preHandler: requireRole('pharmacy_admin', 'super_admin') }, async (req, reply) => {
    const { driverId } = req.params as { orgId: string; driverId: string };
    await db.update(drivers).set({ deletedAt: new Date() }).where(eq(drivers.id, driverId));
    return reply.code(204).send();
  });
};
