import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { stops, routes } from '../db/schema.js';
import { eq, and, isNull, desc, gte, lte, sql } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';

export const pharmacistPortalRoutes: FastifyPluginAsync = async (app) => {
  // GET /orgs/:orgId/pharmacist/queue
  app.get('/queue', {
    preHandler: requireRole('pharmacist', 'pharmacy_admin', 'super_admin'),
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const baseWhere = and(eq(stops.orgId, orgId), isNull(stops.deletedAt));

    // Pending stops with no active route (unassigned or route pending)
    const allPending = await db
      .select({
        id: stops.id,
        recipientName: stops.recipientName,
        address: stops.address,
        rxNumbers: stops.rxNumbers,
        controlledSubstance: stops.controlledSubstance,
        requiresRefrigeration: stops.requiresRefrigeration,
        requiresSignature: stops.requiresSignature,
        deliveryNotes: stops.deliveryNotes,
        windowStart: stops.windowStart,
        windowEnd: stops.windowEnd,
        createdAt: stops.createdAt,
        routeId: stops.routeId,
        routeStatus: routes.status,
        pharmacistApproved: sql<boolean>`(${stops.deliveryNotes} LIKE '%[PHARMACIST_APPROVED]%')`,
      })
      .from(stops)
      .leftJoin(routes, eq(stops.routeId, routes.id))
      .where(and(baseWhere, eq(stops.status, 'pending')))
      .orderBy(desc(stops.createdAt));

    const pendingDispensing = allPending.filter(s => !s.routeId);
    const awaitingPickup = allPending.filter(s => s.routeId && s.routeStatus === 'pending');
    const controlledSubstance = allPending.filter(s => s.controlledSubstance);

    // Driver arrivals — stops where driver has marked arrived today
    const driverArrivals = await db
      .select({
        id: stops.id,
        recipientName: stops.recipientName,
        address: stops.address,
        rxNumbers: stops.rxNumbers,
        controlledSubstance: stops.controlledSubstance,
        requiresRefrigeration: stops.requiresRefrigeration,
        requiresSignature: stops.requiresSignature,
        deliveryNotes: stops.deliveryNotes,
        windowStart: stops.windowStart,
        windowEnd: stops.windowEnd,
        createdAt: stops.createdAt,
        arrivedAt: stops.arrivedAt,
        routeId: stops.routeId,
        routeStatus: routes.status,
        pharmacistApproved: sql<boolean>`(${stops.deliveryNotes} LIKE '%[PHARMACIST_APPROVED]%')`,
      })
      .from(stops)
      .leftJoin(routes, eq(stops.routeId, routes.id))
      .where(and(baseWhere, eq(stops.status, 'arrived'), gte(stops.arrivedAt, todayStart)))
      .orderBy(desc(stops.arrivedAt));

    // Today stats
    const [dispensedRow] = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(stops)
      .where(and(baseWhere, eq(stops.status, 'completed'), gte(stops.completedAt, todayStart), lte(stops.completedAt, todayEnd)));

    const [pendingRow] = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(stops)
      .where(and(baseWhere, eq(stops.status, 'pending')));

    const [controlledRow] = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(stops)
      .where(and(baseWhere, eq(stops.controlledSubstance, true), eq(stops.status, 'pending')));

    return {
      pendingDispensing,
      awaitingPickup,
      controlledSubstance,
      driverArrivals,
      todayStats: {
        dispensed: dispensedRow?.cnt ?? 0,
        pending: pendingRow?.cnt ?? 0,
        controlled: controlledRow?.cnt ?? 0,
      },
    };
  });

  // POST /orgs/:orgId/stops/:stopId/pharmacist-approve
  app.post('/:stopId/pharmacist-approve', {
    preHandler: requireRole('pharmacist', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId, stopId } = req.params as { orgId: string; stopId: string };
    const user = req.user as { sub: string; name?: string };

    const [stop] = await db.select().from(stops)
      .where(and(eq(stops.id, stopId), eq(stops.orgId, orgId), isNull(stops.deletedAt)))
      .limit(1);

    if (!stop) return reply.code(404).send({ error: 'Stop not found' });

    const approvalTag = `[PHARMACIST_APPROVED by ${user.sub} at ${new Date().toISOString()}]`;
    const updatedNotes = stop.deliveryNotes
      ? `${stop.deliveryNotes}\n${approvalTag}`
      : approvalTag;

    const [updated] = await db.update(stops)
      .set({ deliveryNotes: updatedNotes })
      .where(eq(stops.id, stopId))
      .returning();

    return updated;
  });

  // POST /orgs/:orgId/pharmacist/bulk-approve
  app.post('/bulk-approve', {
    preHandler: requireRole('pharmacist', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const { stopIds } = req.body as { stopIds: string[] };
    const user = req.user as { sub: string; name?: string };

    if (!Array.isArray(stopIds) || stopIds.length === 0)
      return reply.code(400).send({ error: 'stopIds required' });

    const approvalTag = `[PHARMACIST_APPROVED by ${user.sub} at ${new Date().toISOString()}]`;
    let approved = 0;

    for (const stopId of stopIds) {
      const [stop] = await db.select({ id: stops.id, deliveryNotes: stops.deliveryNotes })
        .from(stops)
        .where(and(eq(stops.id, stopId), eq(stops.orgId, orgId), isNull(stops.deletedAt)))
        .limit(1);
      if (!stop) continue;
      const updatedNotes = stop.deliveryNotes
        ? `${stop.deliveryNotes}\n${approvalTag}`
        : approvalTag;
      await db.update(stops).set({ deliveryNotes: updatedNotes }).where(eq(stops.id, stopId));
      approved++;
    }

    return { approved, total: stopIds.length };
  });

  // GET /orgs/:orgId/pharmacist/analytics
  app.get('/analytics', {
    preHandler: requireRole('pharmacist', 'pharmacy_admin', 'super_admin'),
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const now = new Date();

    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - 6); weekStart.setHours(0, 0, 0, 0);

    const base = and(eq(stops.orgId, orgId), isNull(stops.deletedAt));

    const [todayStats] = await db.select({
      dispensed: sql<number>`sum(case when ${stops.status} = 'completed' and ${stops.completedAt} >= ${todayStart} then 1 else 0 end)::int`,
      controlled: sql<number>`sum(case when ${stops.controlledSubstance} = true and ${stops.createdAt} >= ${todayStart} then 1 else 0 end)::int`,
      pending: sql<number>`sum(case when ${stops.status} = 'pending' then 1 else 0 end)::int`,
    }).from(stops).where(base);

    const [weekStats] = await db.select({
      dispensed: sql<number>`sum(case when ${stops.status} = 'completed' and ${stops.completedAt} >= ${weekStart} then 1 else 0 end)::int`,
      controlled: sql<number>`sum(case when ${stops.controlledSubstance} = true and ${stops.createdAt} >= ${weekStart} then 1 else 0 end)::int`,
      pending: sql<number>`sum(case when ${stops.status} = 'pending' and ${stops.createdAt} >= ${weekStart} then 1 else 0 end)::int`,
    }).from(stops).where(base);

    return {
      today: { dispensed: todayStats?.dispensed ?? 0, controlled: todayStats?.controlled ?? 0, pending: todayStats?.pending ?? 0 },
      week: { dispensed: weekStats?.dispensed ?? 0, controlled: weekStats?.controlled ?? 0, pending: weekStats?.pending ?? 0 },
    };
  });
};
