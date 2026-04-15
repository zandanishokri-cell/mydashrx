import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { stops, routes, plans, depots, drivers, proofOfDeliveries } from '../db/schema.js';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';

export const pharmacyPortalRoutes: FastifyPluginAsync = async (app) => {
  // GET /pharmacy/my-depot — get this pharmacy's depot info
  app.get('/my-depot', {
    preHandler: requireRole('pharmacist'),
  }, async (req, reply) => {
    const user = req.user as { sub: string; depotIds: string[] };
    const depotId = user.depotIds?.[0];
    if (!depotId) return reply.code(404).send({ error: 'No depot assigned to this account' });
    const [depot] = await db.select().from(depots).where(eq(depots.id, depotId)).limit(1);
    if (!depot) return reply.code(404).send({ error: 'Depot not found' });
    return depot;
  });

  // GET /pharmacy/orders — pharmacy sees their submitted stops
  app.get('/orders', {
    preHandler: requireRole('pharmacist'),
  }, async (req) => {
    const user = req.user as { sub: string; orgId: string; depotIds: string[] };
    const { status, limit = '50', page = '1' } = req.query as { status?: string; limit?: string; page?: string };

    const limitNum = Math.min(100, parseInt(limit));
    const offset = (Math.max(1, parseInt(page)) - 1) * limitNum;

    // Get stops from plans belonging to this pharmacy's depot
    const depotId = user.depotIds?.[0];
    if (!depotId) return { stops: [], total: 0 };

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
        createdAt: stops.createdAt,
        arrivedAt: stops.arrivedAt,
        completedAt: stops.completedAt,
        failureReason: stops.failureReason,
        planDate: plans.date,
        planStatus: plans.status,
      })
      .from(stops)
      .leftJoin(routes, eq(stops.routeId, routes.id))
      .leftJoin(plans, eq(routes.planId, plans.id))
      .where(and(
        eq(stops.orgId, user.orgId),
        isNull(stops.deletedAt),
        eq(plans.depotId, depotId),
        ...(status ? [eq(stops.status, status as any)] : []),
      ))
      .orderBy(desc(stops.createdAt))
      .limit(limitNum)
      .offset(offset);

    return { stops: rows, total: rows.length };
  });

  // POST /pharmacy/orders — pharmacy submits a new delivery stop
  // This creates/finds a draft plan for today and adds the stop
  app.post('/orders', {
    preHandler: requireRole('pharmacist'),
  }, async (req, reply) => {
    const user = req.user as { sub: string; orgId: string; depotIds: string[] };
    const depotId = user.depotIds?.[0];
    if (!depotId) return reply.code(400).send({ error: 'No depot assigned to this account' });

    const body = req.body as {
      recipientName: string;
      recipientPhone: string;
      address: string;
      lat: number;
      lng: number;
      rxNumbers?: string[];
      packageCount?: number;
      requiresRefrigeration?: boolean;
      controlledSubstance?: boolean;
      requiresSignature?: boolean;
      codAmount?: number;
      deliveryNotes?: string;
      deliveryDate?: string; // YYYY-MM-DD, defaults to today
    };

    if (!body.recipientName || !body.address) {
      return reply.code(400).send({ error: 'recipientName and address required' });
    }

    const date = body.deliveryDate ?? new Date().toISOString().split('T')[0];

    // Find or create a draft plan for this depot+date
    let [plan] = await db.select().from(plans)
      .where(and(eq(plans.orgId, user.orgId), eq(plans.depotId, depotId), eq(plans.date, date), isNull(plans.deletedAt)))
      .limit(1);

    if (!plan) {
      [plan] = await db.insert(plans).values({ orgId: user.orgId, depotId, date }).returning();
    }

    // Find or create a default "unassigned" route for the plan
    let [defaultRoute] = await db.select().from(routes)
      .where(and(eq(routes.planId, plan.id), isNull(routes.driverId), isNull(routes.deletedAt)))
      .limit(1);

    if (!defaultRoute) {
      [defaultRoute] = await db.insert(routes).values({ planId: plan.id, driverId: null as any }).returning();
    }

    const [stop] = await db.insert(stops).values({
      routeId: defaultRoute.id,
      orgId: user.orgId,
      recipientName: body.recipientName,
      recipientPhone: body.recipientPhone ?? '',
      address: body.address,
      lat: body.lat ?? 0,
      lng: body.lng ?? 0,
      rxNumbers: body.rxNumbers ?? [],
      packageCount: body.packageCount ?? 1,
      requiresRefrigeration: body.requiresRefrigeration ?? false,
      controlledSubstance: body.controlledSubstance ?? false,
      requiresSignature: body.requiresSignature ?? true,
      codAmount: body.codAmount,
      deliveryNotes: body.deliveryNotes,
    }).returning();

    return reply.code(201).send({ ...stop, planId: plan.id, planDate: plan.date });
  });

  // GET /pharmacy/orders/:stopId — order detail with driver + POD
  app.get('/orders/:stopId', {
    preHandler: requireRole('pharmacist'),
  }, async (req, reply) => {
    const user = req.user as { sub: string; orgId: string };
    const { stopId } = req.params as { stopId: string };

    const [row] = await db
      .select({
        id: stops.id,
        recipientName: stops.recipientName,
        recipientPhone: stops.recipientPhone,
        address: stops.address,
        unit: stops.unit,
        status: stops.status,
        rxNumbers: stops.rxNumbers,
        packageCount: stops.packageCount,
        requiresRefrigeration: stops.requiresRefrigeration,
        controlledSubstance: stops.controlledSubstance,
        requiresSignature: stops.requiresSignature,
        deliveryNotes: stops.deliveryNotes,
        failureReason: stops.failureReason,
        failureNote: stops.failureNote,
        arrivedAt: stops.arrivedAt,
        completedAt: stops.completedAt,
        createdAt: stops.createdAt,
        trackingToken: stops.trackingToken,
        planDate: plans.date,
        planStatus: plans.status,
        driverId: routes.driverId,
        driverName: drivers.name,
        driverPhone: drivers.phone,
        driverStatus: drivers.status,
      })
      .from(stops)
      .leftJoin(routes, eq(stops.routeId, routes.id))
      .leftJoin(plans, eq(routes.planId, plans.id))
      .leftJoin(drivers, eq(routes.driverId, drivers.id))
      .where(and(eq(stops.id, stopId), eq(stops.orgId, user.orgId), isNull(stops.deletedAt)))
      .limit(1);

    if (!row) return reply.code(404).send({ error: 'Not found' });

    // Fetch POD if completed
    const [pod] = await db.select().from(proofOfDeliveries).where(eq(proofOfDeliveries.stopId, stopId)).limit(1);

    return { ...row, pod: pod ?? null };
  });

  // DELETE /pharmacy/orders/:stopId — cancel a pending stop
  app.delete('/orders/:stopId', {
    preHandler: requireRole('pharmacist'),
  }, async (req, reply) => {
    const { stopId } = req.params as { stopId: string };
    const [stop] = await db.select().from(stops).where(eq(stops.id, stopId)).limit(1);
    if (!stop) return reply.code(404).send({ error: 'Not found' });
    if (stop.status !== 'pending') return reply.code(400).send({ error: 'Can only cancel pending stops' });
    await db.update(stops).set({ deletedAt: new Date() }).where(eq(stops.id, stopId));
    return reply.code(204).send();
  });
};
