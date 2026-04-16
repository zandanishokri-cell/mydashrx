import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { drivers, stops, routes, plans } from '../db/schema.js';
import { eq, and, isNull, sql, gte, lte } from 'drizzle-orm';
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
    if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return reply.code(400).send({ error: 'Invalid email address' });
    }
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

  app.get('/:driverId/performance', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId, driverId } = req.params as { orgId: string; driverId: string };
    const query = req.query as { from?: string; to?: string };

    const to = query.to ?? new Date().toISOString().split('T')[0];
    const from = query.from ?? new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const fromTs = new Date(from + 'T00:00:00Z');
    const toTs = new Date(to + 'T23:59:59Z');

    const [driver] = await db
      .select({ id: drivers.id, name: drivers.name })
      .from(drivers)
      .where(and(eq(drivers.id, driverId), eq(drivers.orgId, orgId), isNull(drivers.deletedAt)))
      .limit(1);
    if (!driver) return reply.code(404).send({ error: 'Not found' });

    // All stops for this driver in the period
    const driverStops = await db
      .select({
        id: stops.id,
        status: stops.status,
        failureReason: stops.failureReason,
        completedAt: stops.completedAt,
        createdAt: stops.createdAt,
        windowEnd: stops.windowEnd,
      })
      .from(stops)
      .innerJoin(routes, eq(stops.routeId, routes.id))
      .where(and(
        eq(stops.orgId, orgId),
        eq(routes.driverId, driverId),
        isNull(stops.deletedAt),
        gte(stops.createdAt, fromTs),
        lte(stops.createdAt, toTs),
      ));

    const total = driverStops.length;
    const completed = driverStops.filter(s => s.status === 'completed').length;
    const failed = driverStops.filter(s => s.status === 'failed').length;
    const completionRate = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;

    // On-time rate: completed stops with windowEnd that finished before the window closed
    const completedWithWindow = driverStops.filter(s => s.status === 'completed' && s.windowEnd);
    const onTimeCount = completedWithWindow.filter(s => s.completedAt && s.windowEnd && s.completedAt <= s.windowEnd).length;
    const onTimeRate = completedWithWindow.length > 0 ? Math.round((onTimeCount / completedWithWindow.length) * 1000) / 10 : null;

    // Daily breakdown
    const dailyMap = new Map<string, { total: number; completed: number; failed: number }>();
    for (const s of driverStops) {
      const date = s.createdAt.toISOString().split('T')[0];
      const entry = dailyMap.get(date) ?? { total: 0, completed: 0, failed: 0 };
      entry.total++;
      if (s.status === 'completed') entry.completed++;
      if (s.status === 'failed') entry.failed++;
      dailyMap.set(date, entry);
    }
    const daily = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }));

    const activeDays = dailyMap.size;
    const avgStopsPerDay = activeDays > 0 ? Math.round((total / activeDays) * 10) / 10 : 0;

    // Failure reasons
    const reasonMap = new Map<string, number>();
    for (const s of driverStops.filter(s => s.status === 'failed')) {
      const r = s.failureReason ?? 'unknown';
      reasonMap.set(r, (reasonMap.get(r) ?? 0) + 1);
    }
    const failureReasons = Array.from(reasonMap.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    // Rank among all drivers in org for the period
    const allDriverRows = await db
      .select({
        driverId: routes.driverId,
        total: sql<number>`count(${stops.id})::int`,
        completed: sql<number>`count(case when ${stops.status} = 'completed' then 1 end)::int`,
      })
      .from(stops)
      .innerJoin(routes, eq(stops.routeId, routes.id))
      .where(and(
        eq(stops.orgId, orgId),
        isNull(stops.deletedAt),
        gte(stops.createdAt, fromTs),
        lte(stops.createdAt, toTs),
      ))
      .groupBy(routes.driverId);

    const allRates = allDriverRows.map(r => ({
      driverId: r.driverId,
      rate: r.total > 0 ? r.completed / r.total : 0,
    })).sort((a, b) => b.rate - a.rate);

    const rankIdx = allRates.findIndex(r => r.driverId === driverId);
    const rank = rankIdx === -1 ? null : rankIdx + 1;
    const totalDrivers = allRates.length;

    return {
      driverId,
      driverName: driver.name,
      period: { from, to },
      summary: { totalStops: total, completed, failed, completionRate, avgStopsPerDay, activeDays, onTimeRate },
      daily,
      failureReasons,
      rank,
      totalDrivers,
    };
  });
};
