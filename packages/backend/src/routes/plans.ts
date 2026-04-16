import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { plans, routes, stops, depots } from '../db/schema.js';
import { eq, and, isNull, inArray, notInArray, or, sql } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';
import { optimizeRoute } from '../services/routeOptimizer.js';
import { sendRouteReadyNotifications } from '../services/notifications.js';

// Angular clustering: sort stops by polar angle from depot, distribute round-robin
// Creates geographically contiguous zones (pie slices) rather than arbitrary round-robin
function angularDistribute(
  depotLat: number,
  depotLng: number,
  stopList: Array<{ id: string; lat: number; lng: number }>,
  routeIds: string[],
): Map<string, string[]> {
  const sorted = [...stopList].sort((a, b) => {
    const angleA = Math.atan2(a.lat - depotLat, a.lng - depotLng);
    const angleB = Math.atan2(b.lat - depotLat, b.lng - depotLng);
    return angleA - angleB;
  });

  const assignment = new Map<string, string[]>(routeIds.map((id) => [id, []]));
  sorted.forEach((stop, i) => {
    const routeId = routeIds[i % routeIds.length];
    assignment.get(routeId)!.push(stop.id);
  });
  return assignment;
}

export const planRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', {
    preHandler: requireRole('pharmacy_admin', 'dispatcher', 'super_admin'),
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const { date, depotId } = req.query as { date?: string; depotId?: string };
    const conditions = [eq(plans.orgId, orgId), isNull(plans.deletedAt)];
    if (date) conditions.push(eq(plans.date, date));
    if (depotId) conditions.push(eq(plans.depotId, depotId));
    const planList = await db.select().from(plans).where(and(...conditions)).orderBy(plans.date);
    if (planList.length === 0) return planList;
    // Embed routes so the list view avoids N+1 fetches (one query for all routes)
    const planIds = planList.map((p) => p.id);
    const allRoutes = await db.select().from(routes)
      .where(and(inArray(routes.planId, planIds), isNull(routes.deletedAt)));
    const routesByPlan = new Map<string, typeof allRoutes>();
    for (const r of allRoutes) {
      const arr = routesByPlan.get(r.planId) ?? [];
      arr.push(r);
      routesByPlan.set(r.planId, arr);
    }
    return planList.map((p) => ({ ...p, routes: routesByPlan.get(p.id) ?? [] }));
  });

  app.get('/:planId', {
    preHandler: requireRole('pharmacy_admin', 'dispatcher', 'super_admin'),
  }, async (req, reply) => {
    const { orgId, planId } = req.params as { orgId: string; planId: string };
    const [plan] = await db.select().from(plans)
      .where(and(eq(plans.id, planId), eq(plans.orgId, orgId), isNull(plans.deletedAt)))
      .limit(1);
    if (!plan) return reply.code(404).send({ error: 'Not found' });
    const planRoutes = await db.select().from(routes).where(and(eq(routes.planId, planId), isNull(routes.deletedAt)));
    return { ...plan, routes: planRoutes };
  });

  app.post('/', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const { depotId, date } = req.body as { depotId: string; date: string };
    if (!depotId || !date) return reply.code(400).send({ error: 'depotId and date required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply.code(400).send({ error: 'date must be YYYY-MM-DD' });
    // Verify depot belongs to this org — prevents attaching a plan to a foreign depot
    const [depot] = await db.select({ id: depots.id }).from(depots)
      .where(and(eq(depots.id, depotId), eq(depots.orgId, orgId))).limit(1);
    if (!depot) return reply.code(400).send({ error: 'Invalid depotId' });
    const [plan] = await db.insert(plans).values({ orgId, depotId, date }).returning();
    return reply.code(201).send(plan);
  });

  app.patch('/:planId/distribute', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId, planId } = req.params as { orgId: string; planId: string };

    // Verify plan exists, belongs to org, and has at least one route before distributing
    const [plan] = await db.select().from(plans)
      .where(and(eq(plans.id, planId), eq(plans.orgId, orgId), isNull(plans.deletedAt)))
      .limit(1);
    if (!plan) return reply.code(404).send({ error: 'Not found' });

    const planRouteList = await db.select({ id: routes.id })
      .from(routes).where(and(eq(routes.planId, planId), isNull(routes.deletedAt)));
    if (planRouteList.length === 0) return reply.code(400).send({ error: 'Cannot distribute a plan with no routes' });

    // Idempotent: already distributed is a no-op
    if (plan.status === 'distributed') return plan;

    const [updated] = await db
      .update(plans)
      .set({ status: 'distributed' })
      .where(and(eq(plans.id, planId), eq(plans.orgId, orgId), isNull(plans.deletedAt)))
      .returning();
    if (!updated) return reply.code(404).send({ error: 'Not found' });
    // Notify assigned drivers — fire-and-forget, non-blocking
    sendRouteReadyNotifications(planId, orgId).catch(console.error);
    return updated;
  });

  app.post('/:planId/optimize', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId, planId } = req.params as { orgId: string; planId: string };

    const [plan] = await db.select().from(plans)
      .where(and(eq(plans.id, planId), eq(plans.orgId, orgId), isNull(plans.deletedAt)))
      .limit(1);
    if (!plan) return reply.code(404).send({ error: 'Plan not found' });

    // Block optimization on already-distributed or completed plans
    if (plan.status === 'distributed' || plan.status === 'completed') {
      return reply.code(409).send({ error: `Cannot optimize a plan with status '${plan.status}'` });
    }

    const [depot] = await db.select().from(depots).where(eq(depots.id, plan.depotId)).limit(1);
    if (!depot) return reply.code(404).send({ error: 'Depot not found' });

    // Guard: depot must have valid coordinates for optimizer
    if (!depot.lat || !depot.lng) return reply.code(422).send({ error: 'Depot is missing GPS coordinates — cannot optimize' });

    const planRoutes = await db.select().from(routes).where(and(eq(routes.planId, planId), isNull(routes.deletedAt)));
    if (planRoutes.length === 0) return reply.code(400).send({ error: 'No routes to optimize' });

    // Departure time assumption: today = now; future date = 8am Detroit time on plan.date
    const isToday = plan.date === new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Detroit' }).format(new Date());
    const departureMs = isToday
      ? Date.now()
      : new Date(new Date(`${plan.date}T08:00:00`).toLocaleString('en-US', { timeZone: 'America/Detroit' })).getTime();

    const results = await Promise.all(
      planRoutes.map(async (route) => {
        const routeStops = await db
          .select({
            id: stops.id,
            lat: stops.lat,
            lng: stops.lng,
            status: stops.status,
            address: stops.address,
            recipientName: stops.recipientName,
            windowEnd: stops.windowEnd,
          })
          .from(stops)
          .where(and(
            eq(stops.routeId, route.id),
            isNull(stops.deletedAt),
            // Exclude already-terminal stops from re-optimization
            notInArray(stops.status, ['completed', 'failed', 'rescheduled']),
          ));
        // Filter out stops with missing geocoding (lat=0,lng=0 → pre-geocoding-fix data)
        const geocodedStops = routeStops.filter(s => s.lat !== 0 || s.lng !== 0);
        if (geocodedStops.length === 0) return null;

        // Window lookup: id → { windowEnd, address } (for violation detection after optimize)
        const windowByStopId = new Map(
          routeStops.map((s) => [s.id, { windowEnd: s.windowEnd, address: s.address ?? '' }]),
        );

        const originalOrder = Array.isArray(route.stopOrder) ? [...(route.stopOrder as string[])] : [];
        const optimized = await optimizeRoute(depot.lat, depot.lng, geocodedStops);
        // Use real route duration from optimizer (minutes→seconds); fall back to 8 min/stop estimate
        const estimatedDuration = optimized.totalDuration > 0
          ? Math.round(optimized.totalDuration * 60)
          : optimized.stopIds.length * 8 * 60;

        await db.update(routes).set({
          stopOrder: optimized.stopIds,
          estimatedDuration,
          totalDistance: optimized.totalDistance,
        }).where(eq(routes.id, route.id));

        await Promise.all(
          optimized.stopIds.map((stopId, i) =>
            db.update(stops).set({ sequenceNumber: i }).where(eq(stops.id, stopId)),
          ),
        );

        // Compute cumulative arrival time at each stop using optimized legs
        // 3-minute dwell time per stop accounts for parking + handoff (added AFTER each stop, affects next)
        const DWELL_TIME_MS = 3 * 60_000;
        const windowViolations: { stopId: string; address: string; windowEnd: string; estimatedArrival: string }[] = [];
        let elapsedMs = 0;
        for (let i = 0; i < optimized.stopIds.length; i++) {
          const leg = optimized.legs[i];
          if (leg) elapsedMs += leg.durationMin * 60_000;
          const stopId = optimized.stopIds[i];
          const entry = windowByStopId.get(stopId);
          if (entry?.windowEnd) {
            const estimatedArrivalMs = departureMs + elapsedMs;
            if (estimatedArrivalMs > entry.windowEnd.getTime()) {
              windowViolations.push({
                stopId,
                address: entry.address,
                windowEnd: entry.windowEnd.toISOString(),
                estimatedArrival: new Date(estimatedArrivalMs).toISOString(),
              });
            }
          }
          elapsedMs += DWELL_TIME_MS; // service time at this stop — shifts ETA for all subsequent stops
        }

        return { routeId: route.id, originalOrder, newOrder: optimized.stopIds, estimatedDuration, windowViolations };
      }),
    );

    const optimizedResults = results.filter(Boolean) as {
      routeId: string;
      originalOrder: string[];
      newOrder: string[];
      estimatedDuration: number;
      windowViolations: { stopId: string; address: string; windowEnd: string; estimatedArrival: string }[];
    }[];
    // Only mark optimized if at least one route was actually processed
    if (optimizedResults.length > 0) {
      await db.update(plans).set({ status: 'optimized' }).where(eq(plans.id, planId));
    }
    const allViolations = optimizedResults.flatMap((r) => r.windowViolations);
    return {
      optimized: optimizedResults.length,
      routes: optimizedResults,
      windowViolations: allViolations,
      departureAssumption: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Detroit' }).format(new Date()) === plan.date
        ? 'Departure assumed at current time'
        : `Departure assumed at 08:00 AM on ${plan.date}`,
    };
  });

  app.delete('/:planId', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId, planId } = req.params as { orgId: string; planId: string };
    // Verify ownership before cascade
    const [plan] = await db.select({ id: plans.id }).from(plans)
      .where(and(eq(plans.id, planId), eq(plans.orgId, orgId), isNull(plans.deletedAt))).limit(1);
    if (!plan) return reply.code(404).send({ error: 'Not found' });

    // Cascade: unassign stops + soft-delete routes before deleting plan
    const planRoutes = await db.select({ id: routes.id })
      .from(routes).where(and(eq(routes.planId, planId), isNull(routes.deletedAt)));
    if (planRoutes.length > 0) {
      const routeIds = planRoutes.map(r => r.id);
      await db.update(stops).set({ routeId: null })
        .where(and(inArray(stops.routeId, routeIds), isNull(stops.deletedAt)));
      await db.update(routes).set({ deletedAt: new Date() })
        .where(inArray(routes.id, routeIds));
    }
    await db.update(plans).set({ deletedAt: new Date() }).where(eq(plans.id, planId));
    return reply.code(204).send();
  });

  app.post('/:planId/auto-distribute', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId, planId } = req.params as { orgId: string; planId: string };
    const { stopIds: explicitStopIds } = req.body as { stopIds?: string[] };

    if (explicitStopIds && explicitStopIds.length > 500) {
      return reply.code(400).send({ error: 'explicitStopIds must not exceed 500 items' });
    }

    // Verify plan ownership
    const [plan] = await db.select({ id: plans.id, date: plans.date, depotId: plans.depotId, status: plans.status })
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.orgId, orgId), isNull(plans.deletedAt)))
      .limit(1);
    if (!plan) return reply.code(404).send({ error: 'Plan not found' });

    if (plan.status === 'distributed' || plan.status === 'completed') {
      return reply.code(409).send({ error: `Cannot auto-distribute a plan with status '${plan.status}'` });
    }

    // Get plan routes (only non-deleted)
    const planRouteRows = await db.select({ id: routes.id })
      .from(routes)
      .where(and(eq(routes.planId, planId), isNull(routes.deletedAt)));
    if (planRouteRows.length === 0) return reply.code(400).send({ error: 'Plan has no routes — add drivers first' });

    // Get depot for clustering anchor
    const [depot] = await db.select({ lat: depots.lat, lng: depots.lng })
      .from(depots)
      .where(and(eq(depots.id, plan.depotId), eq(depots.orgId, orgId)))
      .limit(1);
    const depotLat = depot?.lat ?? 42.3314; // Detroit fallback
    const depotLng = depot?.lng ?? -83.0458;

    // Find unassigned stops: either explicit list or auto-discover by plan date + org
    let unassigned: Array<{ id: string; lat: number; lng: number }>;

    if (explicitStopIds && explicitStopIds.length > 0) {
      // Caller provided specific stops — verify they belong to org and are unassigned
      unassigned = await db
        .select({ id: stops.id, lat: stops.lat, lng: stops.lng })
        .from(stops)
        .where(and(
          inArray(stops.id, explicitStopIds),
          eq(stops.orgId, orgId),
          isNull(stops.routeId),
          isNull(stops.deletedAt),
        ));
    } else {
      // Auto-discover: unassigned stops for this org whose window date OR createdAt date matches plan date
      unassigned = await db
        .select({ id: stops.id, lat: stops.lat, lng: stops.lng })
        .from(stops)
        .where(and(
          eq(stops.orgId, orgId),
          isNull(stops.routeId),
          isNull(stops.deletedAt),
          or(
            sql`DATE(${stops.windowStart} AT TIME ZONE 'America/Detroit') = ${plan.date}`,
            sql`DATE(${stops.createdAt} AT TIME ZONE 'America/Detroit') = ${plan.date}`,
          ),
        ));
    }

    if (unassigned.length === 0) return reply.code(400).send({ error: 'No unassigned stops found for this plan date' });
    const skipped = explicitStopIds ? explicitStopIds.length - unassigned.length : 0;

    // Filter out stops with no valid geocoding (0,0 = not geocoded)
    const geocoded = unassigned.filter((s) => s.lat !== 0 || s.lng !== 0);
    const noCoords = unassigned.filter((s) => s.lat === 0 && s.lng === 0);

    const routeIds = planRouteRows.map((r) => r.id);
    const assignment = angularDistribute(depotLat, depotLng, geocoded, routeIds);

    // Distribute non-geocoded stops round-robin (after geocoded)
    noCoords.forEach((stop, i) => {
      const routeId = routeIds[i % routeIds.length];
      assignment.get(routeId)!.push(stop.id);
    });

    // Bulk-assign: set routeId + sequenceNumber for each route's stops
    let totalAssigned = 0;
    const byRoute: { routeId: string; stopCount: number }[] = [];

    for (const routeId of routeIds) {
      const stopIdsForRoute = assignment.get(routeId) ?? [];
      if (stopIdsForRoute.length === 0) continue;

      const [maxSeq] = await db
        .select({ max: sql<number>`COALESCE(MAX(${stops.sequenceNumber}), -1)` })
        .from(stops)
        .where(and(eq(stops.routeId, routeId), isNull(stops.deletedAt)));
      let seq = (maxSeq?.max ?? -1) + 1;

      await Promise.all(
        stopIdsForRoute.map((stopId) =>
          db.update(stops)
            .set({ routeId, sequenceNumber: seq++ })
            .where(and(eq(stops.id, stopId), eq(stops.orgId, orgId), isNull(stops.deletedAt)))
        )
      );

      const existingStops = await db.select({ id: stops.id })
        .from(stops)
        .where(and(eq(stops.routeId, routeId), isNull(stops.deletedAt)))
        .orderBy(stops.sequenceNumber);

      await db.update(routes)
        .set({ stopOrder: existingStops.map((s) => s.id) })
        .where(eq(routes.id, routeId));

      totalAssigned += stopIdsForRoute.length;
      byRoute.push({ routeId, stopCount: stopIdsForRoute.length });
    }

    return { assigned: totalAssigned, byRoute, skipped, depotFallback: !depot };
  });
};
