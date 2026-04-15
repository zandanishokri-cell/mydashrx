import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { stops, routes, plans, drivers } from '../db/schema.js';
import { eq, and, isNull, gte, lte, sql, inArray } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  // GET /orgs/:orgId/dashboard/summary
  app.get('/summary', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // Today's plans → routes → stops in a single joined query
    const todayPlans = await db
      .select({ id: plans.id })
      .from(plans)
      .where(and(
        eq(plans.orgId, orgId),
        isNull(plans.deletedAt),
        eq(plans.date, todayStart.toISOString().split('T')[0]),
      ));

    const planIds = todayPlans.map(p => p.id);

    let stopsToday = 0;
    let completedToday = 0;
    let inProgressToday = 0;

    if (planIds.length > 0) {
      const todayRoutes = await db
        .select({ id: routes.id })
        .from(routes)
        .where(and(
          inArray(routes.planId, planIds),
          isNull(routes.deletedAt),
        ));

      const routeIds = todayRoutes.map(r => r.id);

      if (routeIds.length > 0) {
        const stopCounts = await db
          .select({
            status: stops.status,
            cnt: sql<number>`count(*)::int`,
          })
          .from(stops)
          .where(and(
            eq(stops.orgId, orgId),
            isNull(stops.deletedAt),
            inArray(stops.routeId, routeIds),
          ))
          .groupBy(stops.status);

        for (const row of stopCounts) {
          stopsToday += row.cnt;
          if (row.status === 'completed') completedToday = row.cnt;
          if (row.status === 'en_route' || row.status === 'arrived') inProgressToday += row.cnt;
        }
      }
    }

    // Active drivers: status = 'on_route', not deleted
    const [activeRow] = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(drivers)
      .where(and(
        eq(drivers.orgId, orgId),
        isNull(drivers.deletedAt),
        eq(drivers.status, 'on_route'),
      ));

    return {
      stopsToday,
      completedToday,
      inProgressToday,
      activeDrivers: activeRow?.cnt ?? 0,
    };
  });
};
