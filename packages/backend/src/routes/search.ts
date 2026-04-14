import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { stops, routes, plans, depots, drivers } from '../db/schema.js';
import { eq, and, isNull, ilike, or, gte, lte, sql } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';

export const searchRoutes: FastifyPluginAsync = async (app) => {
  // GET /orgs/:orgId/stops — filterable stop list (used by Stops page + Search page)
  app.get('/stops', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const { q, depotId, status, from, to, driverId, page = '1', limit = '50' } = req.query as {
      q?: string; depotId?: string; status?: string;
      from?: string; to?: string; driverId?: string;
      page?: string; limit?: string;
    };

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [eq(stops.orgId, orgId), isNull(stops.deletedAt)];

    if (q) {
      const like = `%${q}%`;
      conditions.push(or(
        ilike(stops.recipientName, like),
        ilike(stops.address, like),
        ilike(stops.recipientPhone, like),
        sql`${stops.rxNumbers}::text ILIKE ${like}`,
      )!);
    }

    if (status && status !== 'all') {
      if (status === 'in_progress') {
        conditions.push(or(eq(stops.status, 'en_route'), eq(stops.status, 'arrived'))!);
      } else {
        conditions.push(eq(stops.status, status as any));
      }
    }

    if (from) conditions.push(gte(stops.createdAt, new Date(from)));
    if (to) conditions.push(lte(stops.createdAt, new Date(to + 'T23:59:59')));

    // Join to get depot/driver/plan context
    const rows = await db
      .select({
        id: stops.id,
        recipientName: stops.recipientName,
        recipientPhone: stops.recipientPhone,
        address: stops.address,
        status: stops.status,
        rxNumbers: stops.rxNumbers,
        packageCount: stops.packageCount,
        requiresRefrigeration: stops.requiresRefrigeration,
        controlledSubstance: stops.controlledSubstance,
        requiresSignature: stops.requiresSignature,
        requiresPhoto: stops.requiresPhoto,
        codAmount: stops.codAmount,
        sequenceNumber: stops.sequenceNumber,
        arrivedAt: stops.arrivedAt,
        completedAt: stops.completedAt,
        failureReason: stops.failureReason,
        failureNote: stops.failureNote,
        trackingToken: stops.trackingToken,
        deliveryNotes: stops.deliveryNotes,
        createdAt: stops.createdAt,
        routeId: stops.routeId,
        planId: routes.planId,
        planDate: plans.date,
        planStatus: plans.status,
        depotId: plans.depotId,
        depotName: depots.name,
        driverId: routes.driverId,
        driverName: drivers.name,
      })
      .from(stops)
      .leftJoin(routes, eq(stops.routeId, routes.id))
      .leftJoin(plans, eq(routes.planId, plans.id))
      .leftJoin(depots, eq(plans.depotId, depots.id))
      .leftJoin(drivers, eq(routes.driverId, drivers.id))
      .where(and(...conditions))
      .orderBy(sql`${stops.createdAt} DESC`)
      .limit(limitNum)
      .offset(offset);

    // Filter by depotId after join (drizzle doesn't support nullable join conditions easily)
    const filtered = depotId ? rows.filter(r => r.depotId === depotId) : rows;
    const driverFiltered = driverId ? filtered.filter(r => r.driverId === driverId) : filtered;

    // Count total
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(stops)
      .where(and(...conditions));

    return { stops: driverFiltered, total: count, page: pageNum, limit: limitNum };
  });
};
