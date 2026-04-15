import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { stops, routes, plans, drivers, users } from '../db/schema.js';
import { eq, and, isNull, isNotNull, gte, inArray, or, sql } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';

type NotifEvent = {
  id: string;
  type: 'route_completed' | 'stop_failed' | 'stop_assigned';
  title: string;
  body: string;
  timestamp: string;
  link: string | null;
};

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  // GET /orgs/:orgId/notifications
  app.get('/', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };

    // Look up caller's notification preferences
    const callerPayload = req.user as { id: string };
    const [callerUser] = await db.select({ notificationPreferences: users.notificationPreferences })
      .from(users)
      .where(eq(users.id, callerPayload.id));
    const prefs = (callerUser?.notificationPreferences ?? { route_completed: true, stop_failed: true, stop_assigned: true }) as Record<string, boolean>;

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // ── 1. Org's plans (needed to scope routes by org) ─────────────────────
    const orgPlans = await db
      .select({ id: plans.id })
      .from(plans)
      .where(and(eq(plans.orgId, orgId), isNull(plans.deletedAt)));

    const events: NotifEvent[] = [];

    if (orgPlans.length > 0) {
      const planIds = orgPlans.map(p => p.id);

      // ── 2. Completed routes in last 24h ──────────────────────────────────
      const completedRoutes = await db
        .select({
          id: routes.id,
          completedAt: routes.completedAt,
          driverName: drivers.name,
        })
        .from(routes)
        .leftJoin(drivers, eq(routes.driverId, drivers.id))
        .where(and(
          inArray(routes.planId, planIds),
          isNull(routes.deletedAt),
          isNotNull(routes.completedAt),
          gte(routes.completedAt, since),
        ));

      for (const r of completedRoutes) {
        const stopCounts = await db
          .select({ status: stops.status, cnt: sql<number>`count(*)::int` })
          .from(stops)
          .where(and(eq(stops.routeId, r.id), isNull(stops.deletedAt)))
          .groupBy(stops.status);

        const total = stopCounts.reduce((s, row) => s + row.cnt, 0);
        const delivered = stopCounts.find(row => row.status === 'completed')?.cnt ?? 0;

        events.push({
          id: `route_completed_${r.id}`,
          type: 'route_completed',
          title: 'Route Completed',
          body: `${r.driverName ?? 'Driver'} — ${delivered}/${total} stops delivered`,
          timestamp: r.completedAt!.toISOString(),
          link: null,
        });
      }

      // ── 3. Newly assigned stops in last 2h (new_stop events) ─────────────
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const routesInPlans = await db
        .select({ id: routes.id })
        .from(routes)
        .where(and(inArray(routes.planId, planIds), isNull(routes.deletedAt)));

      if (routesInPlans.length > 0) {
        const routeIds = routesInPlans.map(r => r.id);
        const newStops = await db
          .select({ id: stops.id, recipientName: stops.recipientName, address: stops.address, createdAt: stops.createdAt })
          .from(stops)
          .where(and(
            inArray(stops.routeId, routeIds),
            eq(stops.orgId, orgId),
            eq(stops.status, 'pending'),
            isNull(stops.deletedAt),
            gte(stops.createdAt, twoHoursAgo),
          ));

        for (const s of newStops) {
          events.push({
            id: `stop_assigned_${s.id}`,
            type: 'stop_assigned',
            title: 'New Stop Assigned',
            body: `${s.recipientName} — ${s.address.split(',')[0]}`,
            timestamp: s.createdAt.toISOString(),
            link: `/dashboard/stops/${s.id}`,
          });
        }
      }
    }

    // ── 4. Failed stops in last 24h (direct orgId on stops) ──────────────
    const failedStops = await db
      .select({ id: stops.id, recipientName: stops.recipientName, address: stops.address, completedAt: stops.completedAt, createdAt: stops.createdAt })
      .from(stops)
      .where(and(
        eq(stops.orgId, orgId),
        eq(stops.status, 'failed'),
        isNull(stops.deletedAt),
        or(
          and(isNotNull(stops.completedAt), gte(stops.completedAt, since)),
          gte(stops.createdAt, since),
        ),
      ));

    for (const s of failedStops) {
      events.push({
        id: `stop_failed_${s.id}`,
        type: 'stop_failed',
        title: 'Stop Failed',
        body: `${s.recipientName} — ${s.address.split(',')[0]}`,
        timestamp: (s.completedAt ?? s.createdAt).toISOString(),
        link: `/dashboard/stops/${s.id}`,
      });
    }

    const filtered = events.filter(e => prefs[e.type] !== false);
    const sorted = filtered
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 20);

    return { events: sorted, total: sorted.length };
  });
};
