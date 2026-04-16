import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { stops, routes, plans, depots, drivers, leadProspects, proofOfDeliveries } from '../db/schema.js';
import { eq, and, isNull, ilike, or, gte, lte, sql, inArray, ne } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';
import { checkAndNotifyRouteComplete } from './stops.js';
import { geocodeAddress } from '../utils/geocode.js';
import { checkStopLimit } from '../utils/usageLimits.js';

export const searchRoutes: FastifyPluginAsync = async (app) => {
  // GET /orgs/:orgId/stops — filterable stop list (used by Stops page + Search page)
  app.get('/stops', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const { q, depotId, status, from, to, driverId, unassigned, page = '1', limit = '50' } = req.query as {
      q?: string; depotId?: string; status?: string; unassigned?: string;
      from?: string; to?: string; driverId?: string;
      page?: string; limit?: string;
    };

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(10000, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [eq(stops.orgId, orgId), isNull(stops.deletedAt)];

    if (q) {
      const escaped = q.replace(/[%_\\]/g, '\\$&');
      const like = `%${escaped}%`;
      conditions.push(or(
        ilike(stops.recipientName, like),
        ilike(stops.address, like),
        ilike(stops.recipientPhone, like),
        sql`${stops.rxNumbers}::text ILIKE ${like}`,
      )!);
    }

    if (unassigned === 'true') {
      conditions.push(isNull(stops.routeId));
    } else if (status && status !== 'all') {
      if (status === 'in_progress') {
        conditions.push(or(eq(stops.status, 'en_route'), eq(stops.status, 'arrived'))!);
      } else {
        conditions.push(eq(stops.status, status as any));
      }
    }

    // Filter by plan date (delivery date) — skip for unassigned stops (plans.date = NULL for routeId=null)
    if (unassigned !== 'true') {
      if (from) conditions.push(gte(plans.date, from));
      if (to) conditions.push(lte(plans.date, to));
    }

    // Join to get depot/driver/plan context
    // Add depot/driver conditions directly to SQL — post-filtering after LIMIT breaks pagination
    if (depotId) conditions.push(sql`${depots.id} = ${depotId}`);
    if (driverId) conditions.push(sql`${drivers.id} = ${driverId}`);

    const [rows, [{ count }]] = await Promise.all([
      db
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
        .offset(offset),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(stops)
        .leftJoin(routes, eq(stops.routeId, routes.id))
        .leftJoin(plans, eq(routes.planId, plans.id))
        .leftJoin(depots, eq(plans.depotId, depots.id))
        .leftJoin(drivers, eq(routes.driverId, drivers.id))
        .where(and(...conditions)),
    ]);

    return { stops: rows, total: count, page: pageNum, limit: limitNum };
  });

  // GET /orgs/:orgId/stops/:stopId — full stop detail with POD and route context
  app.get('/stops/:stopId', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin', 'pharmacist'),
  }, async (req, reply) => {
    const { orgId, stopId } = req.params as { orgId: string; stopId: string };

    const [row] = await db
      .select({
        id: stops.id,
        recipientName: stops.recipientName,
        recipientPhone: stops.recipientPhone,
        recipientEmail: stops.recipientEmail,
        address: stops.address,
        unit: stops.unit,
        status: stops.status,
        rxNumbers: stops.rxNumbers,
        packageCount: stops.packageCount,
        requiresRefrigeration: stops.requiresRefrigeration,
        controlledSubstance: stops.controlledSubstance,
        requiresSignature: stops.requiresSignature,
        requiresPhoto: stops.requiresPhoto,
        requiresAgeVerification: stops.requiresAgeVerification,
        codAmount: stops.codAmount,
        deliveryNotes: stops.deliveryNotes,
        failureReason: stops.failureReason,
        failureNote: stops.failureNote,
        windowStart: stops.windowStart,
        windowEnd: stops.windowEnd,
        arrivedAt: stops.arrivedAt,
        completedAt: stops.completedAt,
        createdAt: stops.createdAt,
        trackingToken: stops.trackingToken,
        sequenceNumber: stops.sequenceNumber,
        lat: stops.lat,
        lng: stops.lng,
        routeId: stops.routeId,
        routeStatus: routes.status,
        routeStartedAt: routes.startedAt,
        routeCompletedAt: routes.completedAt,
        planId: routes.planId,
        planDate: plans.date,
        planStatus: plans.status,
        depotId: plans.depotId,
        depotName: depots.name,
        driverId: routes.driverId,
        driverName: drivers.name,
        driverPhone: drivers.phone,
        barcodesScanned: stops.barcodesScanned,
        packageConfirmed: stops.packageConfirmed,
      })
      .from(stops)
      .leftJoin(routes, eq(stops.routeId, routes.id))
      .leftJoin(plans, eq(routes.planId, plans.id))
      .leftJoin(depots, eq(plans.depotId, depots.id))
      .leftJoin(drivers, eq(routes.driverId, drivers.id))
      .where(and(eq(stops.id, stopId), eq(stops.orgId, orgId), isNull(stops.deletedAt)))
      .limit(1);

    if (!row) return reply.code(404).send({ error: 'Not found' });

    const [pod] = await db.select().from(proofOfDeliveries)
      .where(eq(proofOfDeliveries.stopId, stopId)).limit(1);

    // Build timeline from known timestamps
    const timeline: Array<{ event: string; timestamp: string | null; meta?: string }> = [
      { event: 'Created', timestamp: row.createdAt?.toISOString() ?? null },
      { event: 'Assigned to route', timestamp: row.routeStartedAt ? null : row.planDate ? `${row.planDate}T00:00:00` : null, meta: row.planId ?? undefined },
      { event: 'Driver picked up', timestamp: row.routeStartedAt?.toISOString() ?? null, meta: row.driverName ?? undefined },
      { event: 'Arrived', timestamp: row.arrivedAt?.toISOString() ?? null },
      ...(row.status === 'completed'
        ? [{ event: 'Completed', timestamp: row.completedAt?.toISOString() ?? null }]
        : row.status === 'failed'
        ? [{ event: 'Failed', timestamp: row.completedAt?.toISOString() ?? null, meta: row.failureReason ?? undefined }]
        : []),
    ].filter(e => e.timestamp);

    return { ...row, pod: pod ?? null, timeline };
  });

  // POST /orgs/:orgId/stops/bulk-action — bulk status update for dispatcher
  app.post('/stops/bulk-action', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const { stopIds, action } = req.body as { stopIds: string[]; action: string };

    if (!Array.isArray(stopIds) || stopIds.length === 0)
      return reply.code(400).send({ error: 'stopIds required' });
    if (!['complete', 'failed'].includes(action))
      return reply.code(400).send({ error: 'action must be complete or failed' });

    const TERMINAL = ['completed', 'failed', 'rescheduled'];

    const eligible = await db
      .select({ id: stops.id, routeId: stops.routeId, status: stops.status })
      .from(stops)
      .where(and(eq(stops.orgId, orgId), isNull(stops.deletedAt), inArray(stops.id, stopIds)));

    const toUpdate = eligible.filter(s => !TERMINAL.includes(s.status));
    const skipped = eligible.length - toUpdate.length;

    if (toUpdate.length === 0) return { updated: 0, skipped };

    const newStatus = action === 'complete' ? 'completed' : 'failed';
    const now = new Date();

    await db.update(stops).set({
      status: newStatus as any,
      completedAt: now,
      ...(action === 'failed' ? { failureReason: 'Bulk marked failed' } : {}),
    }).where(inArray(stops.id, toUpdate.map(s => s.id)));

    // Trigger route completion check + email for affected routes
    const routeIds = [...new Set(toUpdate.map(s => s.routeId).filter((id): id is string => !!id))];
    for (const routeId of routeIds) {
      checkAndNotifyRouteComplete(orgId, routeId).catch(console.error);
    }

    return { updated: toUpdate.length, skipped };
  });

  // GET /orgs/:orgId/routes — list non-completed routes for reassign picker
  app.get('/routes', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };

    const rows = await db
      .select({
        id: routes.id,
        status: routes.status,
        planDate: plans.date,
        driverId: routes.driverId,
        driverName: drivers.name,
        depotName: depots.name,
      })
      .from(routes)
      .innerJoin(plans, and(eq(routes.planId, plans.id), eq(plans.orgId, orgId), isNull(plans.deletedAt)))
      .leftJoin(drivers, eq(routes.driverId, drivers.id))
      .leftJoin(depots, eq(plans.depotId, depots.id))
      .where(and(isNull(routes.deletedAt), ne(routes.status, 'completed')))
      .orderBy(sql`${plans.date} DESC`);

    const routeIds = rows.map(r => r.id);
    const stopCounts: Record<string, number> = {};
    if (routeIds.length > 0) {
      const counts = await db
        .select({ routeId: stops.routeId, count: sql<number>`count(*)::int` })
        .from(stops)
        .where(and(inArray(stops.routeId, routeIds), isNull(stops.deletedAt)))
        .groupBy(stops.routeId);
      for (const c of counts) if (c.routeId) stopCounts[c.routeId] = c.count;
    }

    return { routes: rows.map(r => ({ ...r, stopCount: stopCounts[r.id] ?? 0 })) };
  });

  // POST /orgs/:orgId/stops/bulk-reassign — move selected stops to a different route
  app.post('/stops/bulk-reassign', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const { stopIds, targetRouteId } = req.body as { stopIds: string[]; targetRouteId: string };

    if (!Array.isArray(stopIds) || stopIds.length === 0)
      return reply.code(400).send({ error: 'stopIds required' });
    if (!targetRouteId)
      return reply.code(400).send({ error: 'targetRouteId required' });

    // Verify target route belongs to org and is not completed
    const [targetRoute] = await db
      .select({ id: routes.id, status: routes.status })
      .from(routes)
      .innerJoin(plans, and(eq(routes.planId, plans.id), eq(plans.orgId, orgId), isNull(plans.deletedAt)))
      .where(and(eq(routes.id, targetRouteId), isNull(routes.deletedAt)))
      .limit(1);

    if (!targetRoute) return reply.code(404).send({ error: 'Target route not found' });
    if (targetRoute.status === 'completed') return reply.code(400).send({ error: 'Cannot reassign to completed route' });

    const TERMINAL = ['completed', 'failed', 'rescheduled'];

    const eligible = await db
      .select({ id: stops.id, status: stops.status })
      .from(stops)
      .where(and(eq(stops.orgId, orgId), isNull(stops.deletedAt), inArray(stops.id, stopIds)));

    const toUpdate = eligible.filter(s => !TERMINAL.includes(s.status));
    const skipped = eligible.length - toUpdate.length;

    if (toUpdate.length === 0) return { updated: 0, skipped };

    // Find max sequenceNumber in target route to append at the end
    const [{ maxSeq }] = await db
      .select({ maxSeq: sql<number>`coalesce(max(${stops.sequenceNumber}), -1)` })
      .from(stops)
      .where(and(eq(stops.routeId, targetRouteId), isNull(stops.deletedAt)));

    await Promise.all(
      toUpdate.map((s, i) =>
        db.update(stops)
          .set({ routeId: targetRouteId, sequenceNumber: maxSeq + 1 + i })
          .where(eq(stops.id, s.id))
      )
    );

    return { updated: toUpdate.length, skipped };
  });

  // GET /orgs/:orgId/search — global search across stops, drivers, leads
  app.get('/search', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const { q = '', type = 'all' } = req.query as { q?: string; type?: string };
    if (!q.trim()) return { stops: [], drivers: [], leads: [], total: 0, query: q, took: 0 };

    const start = Date.now();
    const escaped = q.trim().replace(/[%_\\]/g, '\\$&');
    const like = `%${escaped}%`;

    const [stopsRes, driversRes, leadsRes] = await Promise.all([
      (type === 'all' || type === 'stops') ? db
        .select({
          id: stops.id,
          recipientName: stops.recipientName,
          address: stops.address,
          status: stops.status,
          routeId: stops.routeId,
          driverName: drivers.name,
          planDate: plans.date,
          createdAt: stops.createdAt,
        })
        .from(stops)
        .leftJoin(routes, eq(stops.routeId, routes.id))
        .leftJoin(plans, eq(routes.planId, plans.id))
        .leftJoin(drivers, eq(routes.driverId, drivers.id))
        .where(and(
          eq(stops.orgId, orgId),
          isNull(stops.deletedAt),
          or(
            ilike(stops.recipientName, like),
            ilike(stops.address, like),
            ilike(stops.recipientPhone, like),
            sql`${stops.rxNumbers}::text ILIKE ${like}`,
          )!,
        ))
        .orderBy(sql`${stops.createdAt} DESC`)
        .limit(20) : Promise.resolve([]),

      (type === 'all' || type === 'drivers') ? db
        .select({
          id: drivers.id,
          name: drivers.name,
          email: drivers.email,
          phone: drivers.phone,
          status: drivers.status,
          vehicleType: drivers.vehicleType,
        })
        .from(drivers)
        .where(and(
          eq(drivers.orgId, orgId),
          isNull(drivers.deletedAt),
          or(
            ilike(drivers.name, like),
            ilike(drivers.email, like),
            ilike(drivers.phone, like),
          )!,
        ))
        .limit(10) : Promise.resolve([]),

      (type === 'all' || type === 'leads') ? db
        .select({
          id: leadProspects.id,
          name: leadProspects.name,
          city: leadProspects.city,
          state: leadProspects.state,
          score: leadProspects.score,
          status: leadProspects.status,
          ownerName: leadProspects.ownerName,
          phone: leadProspects.phone,
        })
        .from(leadProspects)
        .where(and(
          eq(leadProspects.orgId, orgId),
          isNull(leadProspects.deletedAt),
          or(
            ilike(leadProspects.name, like),
            ilike(leadProspects.city, like),
            ilike(leadProspects.ownerName, like),
          )!,
        ))
        .limit(10) : Promise.resolve([]),
    ]);

    const total = stopsRes.length + driversRes.length + leadsRes.length;
    return { stops: stopsRes, drivers: driversRes, leads: leadsRes, total, query: q.trim(), took: Date.now() - start };
  });

  // POST /orgs/:orgId/stops — create a single unassigned stop (no route required)
  app.post('/stops', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = req.body as {
      recipientName: string;
      recipientPhone?: string;
      recipientEmail?: string;
      address: string;
      unit?: string;
      rxNumbers?: string[];
      packageCount?: number;
      requiresRefrigeration?: boolean;
      controlledSubstance?: boolean;
      requiresSignature?: boolean;
      requiresAgeVerification?: boolean;
      requiresPhoto?: boolean;
      windowStart?: string;
      windowEnd?: string;
      deliveryNotes?: string;
    };

    if (!body.recipientName?.trim()) return reply.code(400).send({ error: 'recipientName is required' });
    if (!body.address?.trim()) return reply.code(400).send({ error: 'address is required' });

    const limitCheck = await checkStopLimit(orgId);
    if (!limitCheck.allowed) {
      return reply.code(402).send({
        error: 'Stop limit reached',
        message: `Your plan allows ${limitCheck.limit} stops per month. You've used ${limitCheck.current}. Upgrade to add more stops.`,
        current: limitCheck.current,
        limit: limitCheck.limit,
      });
    }

    const geo = await geocodeAddress(body.address.trim());

    const [stop] = await db.insert(stops).values({
      orgId,
      recipientName: body.recipientName.trim(),
      recipientPhone: body.recipientPhone?.trim() ?? '',
      recipientEmail: body.recipientEmail?.trim() || undefined,
      address: body.address.trim(),
      unit: body.unit?.trim() || undefined,
      rxNumbers: body.rxNumbers ?? [],
      packageCount: body.packageCount ?? 1,
      requiresRefrigeration: body.requiresRefrigeration ?? false,
      controlledSubstance: body.controlledSubstance ?? false,
      requiresSignature: body.requiresSignature ?? true,
      requiresAgeVerification: body.requiresAgeVerification ?? false,
      requiresPhoto: body.requiresPhoto ?? false,
      windowStart: body.windowStart ? new Date(body.windowStart) : undefined,
      windowEnd: body.windowEnd ? new Date(body.windowEnd) : undefined,
      deliveryNotes: body.deliveryNotes?.trim() || undefined,
      lat: geo.lat,
      lng: geo.lng,
      status: 'pending',
    }).returning();

    return reply.code(201).send(stop);
  });
};
