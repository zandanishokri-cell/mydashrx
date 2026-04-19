// P-COMP15: Multi-location chain dashboard — aggregate KPIs across all orgs in a chain
// Role: chain_owner (super_admin also has full access)
// GET /chain/dashboard — aggregate metrics across all orgs in caller's chain
// POST /chain — create a new chain (super_admin only)
// PATCH /chain/:chainId/orgs/:orgId — assign org to chain (super_admin or chain_owner)

import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { organizations, routes, stops, drivers, chains, auditLogs } from '../db/schema.js';
import { eq, and, isNull, sql, inArray } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';

const SUPER = requireRole('super_admin');
const CHAIN_OR_SUPER = requireRole('super_admin', 'pharmacy_admin');

export const chainRoutes: FastifyPluginAsync = async (app) => {

  // POST /chain — create chain (super_admin only)
  app.post('/', { preHandler: SUPER }, async (req, reply) => {
    const user = req.user as { sub: string; email: string; orgId: string };
    const { name } = req.body as { name?: string };
    if (!name?.trim()) return reply.code(400).send({ error: 'name is required' });

    const [chain] = await db.insert(chains).values({
      name: name.trim(),
      ownerId: user.sub,
    }).returning();

    db.insert(auditLogs).values({
      orgId: user.orgId,
      userId: user.sub,
      userEmail: user.email,
      action: 'chain_created',
      resource: 'chain',
      resourceId: chain.id,
      metadata: { name: chain.name },
    }).catch(console.error);

    return reply.code(201).send(chain);
  });

  // PATCH /chain/:chainId/orgs/:orgId — assign org to chain
  app.patch('/:chainId/orgs/:orgId', { preHandler: SUPER }, async (req, reply) => {
    const user = req.user as { sub: string; email: string; orgId: string };
    const { chainId, orgId: targetOrgId } = req.params as { chainId: string; orgId: string };

    const [chain] = await db.select().from(chains).where(eq(chains.id, chainId)).limit(1);
    if (!chain) return reply.code(404).send({ error: 'Chain not found' });

    const [org] = await db.update(organizations)
      .set({ chainId })
      .where(eq(organizations.id, targetOrgId))
      .returning({ id: organizations.id, name: organizations.name });
    if (!org) return reply.code(404).send({ error: 'Organization not found' });

    db.insert(auditLogs).values({
      orgId: user.orgId,
      userId: user.sub,
      userEmail: user.email,
      action: 'org_assigned_to_chain',
      resource: 'chain',
      resourceId: chainId,
      metadata: { assignedOrgId: targetOrgId, assignedOrgName: org.name },
    }).catch(console.error);

    return { ok: true, chainId, orgId: targetOrgId };
  });

  // GET /chain/dashboard — aggregate KPIs across all orgs in the chain
  // Accessible by super_admin (sees all chains) or pharmacy_admin of a chain-member org
  app.get('/dashboard', { preHandler: CHAIN_OR_SUPER }, async (req, reply) => {
    const user = req.user as { sub: string; role: string; orgId: string; chainId?: string };

    let chainId: string | null = null;

    if (user.role === 'super_admin') {
      // super_admin can pass ?chainId= or sees all
      chainId = (req.query as { chainId?: string }).chainId ?? null;
    } else {
      // pharmacy_admin — look up their org's chainId
      const [org] = await db
        .select({ chainId: organizations.chainId })
        .from(organizations)
        .where(eq(organizations.id, user.orgId))
        .limit(1);
      chainId = org?.chainId ?? null;
      if (!chainId) return reply.code(403).send({ error: 'Your organization is not part of a chain' });
    }

    // Fetch all orgs in chain
    const orgFilter = chainId
      ? and(isNull(organizations.deletedAt), eq(organizations.chainId, chainId))
      : isNull(organizations.deletedAt);

    const orgRows = await db
      .select({ id: organizations.id, name: organizations.name, timezone: organizations.timezone })
      .from(organizations)
      .where(orgFilter);

    if (!orgRows.length) return { chain: null, locations: [], summary: { totalStopsToday: 0, activeRoutes: 0, completionRate: 0 } };

    const orgIds = orgRows.map(o => o.id);

    // Today's date (UTC date string for simple comparison)
    const today = new Date().toISOString().slice(0, 10);

    // Aggregate per-location metrics in parallel
    const locationMetrics = await Promise.all(orgRows.map(async (org) => {
      const [stopsToday, activeRoutesCount, driversCount, completedToday, totalToday] = await Promise.all([
        // total stops scheduled today
        db.select({ cnt: sql<number>`count(*)::int` })
          .from(stops)
          .where(and(eq(stops.orgId, org.id), isNull(stops.deletedAt),
            sql`DATE(stops.created_at) = ${today}::date`))
          .then(r => r[0]?.cnt ?? 0),
        // active routes
        db.select({ cnt: sql<number>`count(*)::int` })
          .from(routes)
          .where(and(eq(sql`(SELECT org_id FROM plans WHERE id = ${routes.planId} LIMIT 1)`, org.id),
            eq(routes.status, 'active'), isNull(routes.deletedAt)))
          .then(r => r[0]?.cnt ?? 0),
        // available drivers
        db.select({ cnt: sql<number>`count(*)::int` })
          .from(drivers)
          .where(and(eq(drivers.orgId, org.id), isNull(drivers.deletedAt)))
          .then(r => r[0]?.cnt ?? 0),
        // completed stops today
        db.select({ cnt: sql<number>`count(*)::int` })
          .from(stops)
          .where(and(eq(stops.orgId, org.id), isNull(stops.deletedAt),
            eq(stops.status, 'completed'),
            sql`DATE(stops.completed_at) = ${today}::date`))
          .then(r => r[0]?.cnt ?? 0),
        // total terminal stops today (completed + failed)
        db.select({ cnt: sql<number>`count(*)::int` })
          .from(stops)
          .where(and(eq(stops.orgId, org.id), isNull(stops.deletedAt),
            inArray(stops.status, ['completed', 'failed']),
            sql`DATE(stops.created_at) = ${today}::date`))
          .then(r => r[0]?.cnt ?? 0),
      ]);

      const completionRate = totalToday > 0 ? Math.round((completedToday / totalToday) * 100) : null;

      return {
        orgId: org.id,
        name: org.name,
        timezone: org.timezone,
        stopsToday: stopsToday,
        activeRoutes: activeRoutesCount,
        driverCount: driversCount,
        completedToday,
        completionRate,
      };
    }));

    // Aggregate chain summary
    const summary = {
      totalStopsToday: locationMetrics.reduce((a, l) => a + l.stopsToday, 0),
      activeRoutes: locationMetrics.reduce((a, l) => a + l.activeRoutes, 0),
      completionRate: (() => {
        const total = locationMetrics.reduce((a, l) => a + l.stopsToday, 0);
        const done = locationMetrics.reduce((a, l) => a + l.completedToday, 0);
        return total > 0 ? Math.round((done / total) * 100) : null;
      })(),
      locationCount: locationMetrics.length,
    };

    // Fetch chain info
    const chain = chainId
      ? await db.select().from(chains).where(eq(chains.id, chainId)).limit(1).then(r => r[0] ?? null)
      : null;

    return { chain, locations: locationMetrics, summary };
  });
};
