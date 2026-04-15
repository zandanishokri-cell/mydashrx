import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { organizations, users, stops, drivers } from '../db/schema.js';
import { eq, isNull, sql, gte, count } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';

const PLAN_PRICES: Record<string, number> = {
  starter: 0, growth: 99, pro: 249, enterprise: 499,
};

export const superAdminRoutes: FastifyPluginAsync = async (app) => {
  const auth = requireRole('super_admin');

  // GET /admin/stats
  app.get('/stats', { preHandler: auth }, async () => {
    const since30d = new Date(Date.now() - 30 * 86400000);

    const [allOrgs, allDrivers, stops30d, stopsAll] = await Promise.all([
      db.select({ id: organizations.id, billingPlan: organizations.billingPlan })
        .from(organizations).where(isNull(organizations.deletedAt)),
      db.select({ id: drivers.id }).from(drivers).where(isNull(drivers.deletedAt)),
      db.select({ count: sql<number>`count(*)::int` }).from(stops)
        .where(sql`${stops.createdAt} >= ${since30d} AND ${stops.deletedAt} IS NULL`),
      db.select({ count: sql<number>`count(*)::int` }).from(stops)
        .where(isNull(stops.deletedAt)),
    ]);

    // Active orgs: at least 1 stop in last 30 days
    const activeOrgRows = await db
      .select({ orgId: stops.orgId })
      .from(stops)
      .where(sql`${stops.createdAt} >= ${since30d} AND ${stops.deletedAt} IS NULL`)
      .groupBy(stops.orgId);

    // Top 5 orgs by stops in last 30d
    const topOrgRows = await db
      .select({
        orgId: stops.orgId,
        stops30d: sql<number>`count(*)::int`,
      })
      .from(stops)
      .where(sql`${stops.createdAt} >= ${since30d} AND ${stops.deletedAt} IS NULL`)
      .groupBy(stops.orgId)
      .orderBy(sql`count(*) DESC`)
      .limit(5);

    const orgNameMap = Object.fromEntries(allOrgs.map(o => [o.id, o]));
    const orgNames = await db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(isNull(organizations.deletedAt));
    const nameMap = Object.fromEntries(orgNames.map(o => [o.id, o.name]));

    const revenueEstimate = allOrgs.reduce((sum, o) => sum + (PLAN_PRICES[o.billingPlan] ?? 0), 0);

    return {
      totalOrgs: allOrgs.length,
      activeOrgs: activeOrgRows.length,
      totalDrivers: allDrivers.length,
      totalStops30d: stops30d[0]?.count ?? 0,
      totalStopsAllTime: stopsAll[0]?.count ?? 0,
      topOrgs: topOrgRows.map(r => ({
        orgId: r.orgId,
        orgName: nameMap[r.orgId] ?? 'Unknown',
        stops30d: r.stops30d,
      })),
      revenueEstimate,
    };
  });

  // GET /admin/orgs
  app.get('/orgs', { preHandler: auth }, async () => {
    const since30d = new Date(Date.now() - 30 * 86400000);

    const orgs = await db
      .select()
      .from(organizations)
      .where(isNull(organizations.deletedAt))
      .orderBy(organizations.createdAt);

    const [userCounts, stopCounts] = await Promise.all([
      db.select({ orgId: users.orgId, cnt: sql<number>`count(*)::int` })
        .from(users).where(isNull(users.deletedAt)).groupBy(users.orgId),
      db.select({ orgId: stops.orgId, cnt: sql<number>`count(*)::int` })
        .from(stops)
        .where(sql`${stops.createdAt} >= ${since30d} AND ${stops.deletedAt} IS NULL`)
        .groupBy(stops.orgId),
    ]);

    const ucMap = Object.fromEntries(userCounts.map(r => [r.orgId, r.cnt]));
    const scMap = Object.fromEntries(stopCounts.map(r => [r.orgId, r.cnt]));

    return orgs.map(o => ({
      id: o.id,
      name: o.name,
      timezone: o.timezone,
      billingPlan: o.billingPlan,
      hipaaBaaStatus: o.hipaaBaaStatus,
      userCount: ucMap[o.id] ?? 0,
      stopCount30d: scMap[o.id] ?? 0,
      createdAt: o.createdAt,
    }));
  });

  // GET /admin/orgs/:orgId
  app.get('/orgs/:orgId', { preHandler: auth }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const since30d = new Date(Date.now() - 30 * 86400000);

    const [org] = await db.select().from(organizations)
      .where(eq(organizations.id, orgId));
    if (!org) return reply.code(404).send({ error: 'Org not found' });

    const [ucRow, scRow, scAllRow] = await Promise.all([
      db.select({ cnt: sql<number>`count(*)::int` }).from(users)
        .where(sql`${users.orgId} = ${orgId} AND ${users.deletedAt} IS NULL`),
      db.select({ cnt: sql<number>`count(*)::int` }).from(stops)
        .where(sql`${stops.orgId} = ${orgId} AND ${stops.createdAt} >= ${since30d} AND ${stops.deletedAt} IS NULL`),
      db.select({ cnt: sql<number>`count(*)::int` }).from(stops)
        .where(sql`${stops.orgId} = ${orgId} AND ${stops.deletedAt} IS NULL`),
    ]);

    return {
      ...org,
      userCount: ucRow[0]?.cnt ?? 0,
      stopCount30d: scRow[0]?.cnt ?? 0,
      stopCountAllTime: scAllRow[0]?.cnt ?? 0,
    };
  });

  // PATCH /admin/orgs/:orgId/plan
  app.patch('/orgs/:orgId/plan', { preHandler: auth }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const { plan } = req.body as { plan: string };
    const valid = ['starter', 'growth', 'pro', 'enterprise'];
    if (!valid.includes(plan)) return reply.code(400).send({ error: 'Invalid plan' });

    const [updated] = await db
      .update(organizations)
      .set({ billingPlan: plan as any })
      .where(eq(organizations.id, orgId))
      .returning();
    if (!updated) return reply.code(404).send({ error: 'Org not found' });
    return { ok: true, billingPlan: updated.billingPlan };
  });

  // PATCH /admin/orgs/:orgId/baa
  app.patch('/orgs/:orgId/baa', { preHandler: auth }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const { status } = req.body as { status: string };
    const valid = ['pending', 'signed', 'not_required', 'expired'];
    if (!valid.includes(status)) return reply.code(400).send({ error: 'Invalid BAA status' });

    const [updated] = await db
      .update(organizations)
      .set({ hipaaBaaStatus: status })
      .where(eq(organizations.id, orgId))
      .returning();
    if (!updated) return reply.code(404).send({ error: 'Org not found' });
    return { ok: true, hipaaBaaStatus: updated.hipaaBaaStatus };
  });

  // POST /admin/orgs
  app.post('/orgs', { preHandler: auth }, async (req, reply) => {
    const { name, timezone = 'America/New_York', adminName, adminEmail, adminPassword } = req.body as {
      name: string; timezone?: string;
      adminName: string; adminEmail: string; adminPassword: string;
    };
    if (!name || !adminName || !adminEmail || !adminPassword)
      return reply.code(400).send({ error: 'name, adminName, adminEmail, adminPassword required' });

    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.default.hash(adminPassword, 10);

    const [org] = await db.insert(organizations).values({ name, timezone }).returning();

    const [user] = await db.insert(users).values({
      orgId: org.id,
      name: adminName,
      email: adminEmail,
      passwordHash: hash,
      role: 'pharmacy_admin',
    }).returning();

    return { org, adminUser: { id: user.id, email: user.email, name: user.name } };
  });
};
