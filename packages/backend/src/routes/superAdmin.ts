import type { FastifyPluginAsync } from 'fastify';
import { createHmac, timingSafeEqual } from 'crypto';
import { db } from '../db/connection.js';
import { organizations, users, stops, drivers, adminAuditLogs, magicLinkTokens, refreshTokens } from '../db/schema.js';
import { eq, isNull, sql, gte, count, and, desc, lt, or, isNotNull, inArray } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';

const PLAN_PRICES: Record<string, number> = {
  starter: 0, growth: 99, pro: 249, enterprise: 499,
};

async function logAuditAction(
  actorId: string, actorEmail: string,
  action: string, targetId: string, targetName: string,
  metadata?: Record<string, unknown>
) {
  await db.insert(adminAuditLogs).values({
    actorId, actorEmail, action, targetId, targetName,
    metadata: metadata ?? null,
  }).catch((e: unknown) => { console.error('[AuditLog] insert failed:', e); });
}

export const superAdminRoutes: FastifyPluginAsync = async (app) => {
  const auth = requireRole('super_admin');

  // GET /admin/stats
  app.get('/stats', { preHandler: auth }, async () => {
    const since30d = new Date(Date.now() - 30 * 86400000).toISOString();

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

    // P-ADM12: approval funnel health
    const since7d = new Date(Date.now() - 7 * 86400000);
    const [approvedLast7d, rejectedLast7d, pendingOrgs] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(organizations)
        .where(and(isNull(organizations.deletedAt), sql`${organizations.approvedAt} >= ${since7d.toISOString()}`)),
      db.select({ count: sql<number>`count(*)::int` }).from(organizations)
        .where(and(isNull(organizations.deletedAt), sql`${organizations.rejectedAt} >= ${since7d.toISOString()}`)),
      db.select({ createdAt: organizations.createdAt }).from(organizations)
        .where(and(eq(organizations.pendingApproval, true), isNull(organizations.deletedAt))),
    ]);
    const nowMs = Date.now();
    const pendingOver24h = pendingOrgs.filter(o => nowMs - new Date(o.createdAt).getTime() > 24 * 3600_000).length;
    const approvedWithTime = await db.select({ createdAt: organizations.createdAt, approvedAt: organizations.approvedAt })
      .from(organizations).where(and(isNull(organizations.deletedAt), isNotNull(organizations.approvedAt)));
    const hoursArr = approvedWithTime
      .filter(o => o.approvedAt)
      .map(o => (new Date(o.approvedAt!).getTime() - new Date(o.createdAt).getTime()) / 3600_000);
    const avgHoursToApproval = hoursArr.length ? Math.round(hoursArr.reduce((s, h) => s + h, 0) / hoursArr.length * 10) / 10 : null;

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
      approvalHealth: {
        pending: pendingOrgs.length,
        approvedLast7d: approvedLast7d[0]?.count ?? 0,
        rejectedLast7d: rejectedLast7d[0]?.count ?? 0,
        pendingOver24h,
        avgHoursToApproval,
      },
    };
  });

  // GET /admin/orgs
  app.get('/orgs', { preHandler: auth }, async () => {
    const since30d = new Date(Date.now() - 30 * 86400000).toISOString();

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
    const since30d = new Date(Date.now() - 30 * 86400000).toISOString();

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

  // ─── Approval Queue ────────────────────────────────────────────────────────

  // GET /admin/approvals — list pending orgs with their admin user
  app.get('/approvals', { preHandler: auth }, async () => {
    const pendingOrgs = await db
      .select()
      .from(organizations)
      .where(and(eq(organizations.pendingApproval, true), isNull(organizations.deletedAt)))
      .orderBy(organizations.createdAt);

    const results = await Promise.all(pendingOrgs.map(async (org) => {
      const [admin] = await db
        .select({ id: users.id, name: users.name, email: users.email, createdAt: users.createdAt })
        .from(users)
        .where(and(eq(users.orgId, org.id), eq(users.role, 'pharmacy_admin'), isNull(users.deletedAt)))
        .limit(1);
      return { org, admin: admin ?? null };
    }));

    return results;
  });

  // POST /admin/approvals/:orgId/approve
  app.post('/approvals/:orgId/approve', { preHandler: auth }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return reply.code(404).send({ error: 'Organization not found' });

    await db.update(organizations).set({ pendingApproval: false, approvedAt: new Date() }).where(eq(organizations.id, orgId));
    await db.update(users).set({ pendingApproval: false }).where(and(eq(users.orgId, orgId), isNull(users.deletedAt)));

    // Send welcome email to pharmacy admin
    const [admin] = await db.select({ email: users.email, name: users.name })
      .from(users).where(and(eq(users.orgId, orgId), eq(users.role, 'pharmacy_admin'), isNull(users.deletedAt))).limit(1);

    const resendKey = process.env.RESEND_API_KEY;
    const senderDomain = process.env.SENDER_DOMAIN ?? 'mydashrx.com';
    const dashUrl = process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';

    if (admin && resendKey) {
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: `MyDashRx <noreply@${senderDomain}>`,
          to: admin.email,
          subject: `Welcome to MyDashRx — ${org.name} is approved!`,
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
              <h2 style="color:#0F4C81;margin:0 0 8px">You're approved — let's get delivering!</h2>
              <p style="color:#374151;margin:0 0 8px;font-size:15px">Hi ${admin.name},</p>
              <p style="color:#374151;margin:0 0 24px;font-size:15px"><strong>${org.name}</strong> is now live on MyDashRx. Complete these 3 steps and you'll have your first delivery route running today.</p>
              <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px 20px;margin-bottom:24px">
                <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px">
                  <span style="background:#0F4C81;color:#fff;border-radius:50%;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">1</span>
                  <div><p style="margin:0;font-size:14px;font-weight:600;color:#0c4a6e">Add your depot</p><p style="margin:2px 0 0;font-size:13px;color:#0369a1">Your pharmacy location — used as the route start point</p></div>
                </div>
                <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px">
                  <span style="background:#0F4C81;color:#fff;border-radius:50%;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">2</span>
                  <div><p style="margin:0;font-size:14px;font-weight:600;color:#0c4a6e">Add a driver</p><p style="margin:2px 0 0;font-size:13px;color:#0369a1">They'll get the app + their first route automatically</p></div>
                </div>
                <div style="display:flex;align-items:flex-start;gap:12px">
                  <span style="background:#0F4C81;color:#fff;border-radius:50%;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">3</span>
                  <div><p style="margin:0;font-size:14px;font-weight:600;color:#0c4a6e">Create your first delivery plan</p><p style="margin:2px 0 0;font-size:13px;color:#0369a1">Import stops via CSV or add individually</p></div>
                </div>
              </div>
              <a href="${dashUrl}/login?welcome=1" style="display:inline-block;background:#0F4C81;color:#fff;text-decoration:none;padding:13px 28px;border-radius:8px;font-size:15px;font-weight:600;margin-bottom:16px">Sign in &amp; start setup →</a>
              <p style="color:#9ca3af;font-size:12px;margin:16px 0 0">Need help? Reply to this email or book a 15-min setup call: <a href="mailto:onboarding@mydashrx.com?subject=Setup%20call%20for%20${encodeURIComponent(org.name)}" style="color:#0F4C81">onboarding@mydashrx.com</a></p>
            </div>`,
        }),
      }).catch((e: unknown) => { console.error('[Resend] approval email failed:', e); });
    }

    const actor = req.user as { sub: string; email: string };
    await logAuditAction(actor.sub, actor.email, 'approve_org', orgId, org.name);

    return { success: true, orgId };
  });

  // POST /admin/approvals/:orgId/reject
  app.post('/approvals/:orgId/reject', { preHandler: auth }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const { reason } = (req.body as { reason?: string }) ?? {};
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return reply.code(404).send({ error: 'Organization not found' });

    await db.update(organizations)
      .set({ pendingApproval: false, rejectedAt: new Date(), rejectionReason: reason ?? null })
      .where(eq(organizations.id, orgId));

    const [admin] = await db.select({ email: users.email, name: users.name })
      .from(users).where(eq(users.orgId, orgId)).limit(1);

    const resendKey = process.env.RESEND_API_KEY;
    const senderDomain = process.env.SENDER_DOMAIN ?? 'mydashrx.com';

    if (admin && resendKey) {
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: `MyDashRx <noreply@${senderDomain}>`,
          to: admin.email,
          subject: `MyDashRx — Application update for ${org.name}`,
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
              <h2 style="color:#374151;margin:0 0 8px">Update on your MyDashRx application</h2>
              <p style="color:#374151;margin:0 0 8px;font-size:15px">Hi ${admin.name},</p>
              <p style="color:#374151;margin:0 0 16px;font-size:15px">We reviewed the application for <strong>${org.name}</strong> and are unable to approve it at this time.</p>
              ${reason ? `<div style="background:#fef9ec;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-bottom:16px"><p style="color:#92400e;font-size:13px;font-weight:600;margin:0 0 4px">Reason:</p><p style="color:#78350f;font-size:14px;margin:0">${reason}</p></div>` : ''}
              <p style="color:#6b7280;font-size:14px;margin:0 0 8px">If you believe this is an error or have questions, reply to this email or contact <a href="mailto:support@mydashrx.com" style="color:#0F4C81">support@mydashrx.com</a>. We respond within 2 business hours.</p>
              <p style="color:#9ca3af;font-size:12px;margin-top:24px">Application ref: ${orgId}</p>
            </div>`,
        }),
      }).catch((e: unknown) => { console.error('[Resend] approval email failed:', e); });
    }

    const actor = req.user as { sub: string; email: string };
    await logAuditAction(actor.sub, actor.email, 'reject_org', orgId, org.name, { reason: reason ?? null });

    return { success: true, orgId };
  });

  // POST /admin/approvals/batch — batch approve or reject
  app.post('/approvals/batch', { preHandler: auth }, async (req, reply) => {
    const { orgIds, action } = req.body as { orgIds?: string[]; action?: 'approve' | 'reject' };
    if (!Array.isArray(orgIds) || orgIds.length === 0) return reply.code(400).send({ error: 'orgIds array required' });
    if (action !== 'approve' && action !== 'reject') return reply.code(400).send({ error: 'action must be approve or reject' });

    await Promise.all(orgIds.map(id =>
      app.inject({
        method: 'POST',
        url: `/api/v1/admin/approvals/${id}/${action}`,
        headers: { authorization: (req.headers as any).authorization ?? '' },
      })
    ));

    return { success: true, processed: orgIds.length };
  });

  // GET /admin/audit-log — last 50 approval/rejection actions (HIPAA §164.312(b))
  app.get('/audit-log', { preHandler: auth }, async () => {
    return db
      .select()
      .from(adminAuditLogs)
      .orderBy(desc(adminAuditLogs.createdAt))
      .limit(50);
  });

  // GET /admin/approvals/:orgId/approve-link — P-ADM11: HMAC-signed one-click approve URL
  app.get('/approvals/:orgId/approve-link', { preHandler: auth }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const secret = process.env.MAGIC_LINK_SECRET ?? 'fallback-secret';
    const exp = Math.floor(Date.now() / 1000) + 48 * 3600; // 48hr expiry
    const payload = `${orgId}:${exp}`;
    const sig = createHmac('sha256', secret).update(payload).digest('hex');
    const dashUrl = process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
    return { url: `${dashUrl}/admin/approve?orgId=${orgId}&exp=${exp}&sig=${sig}` };
  });

  // GET /admin/approvals/approve — P-ADM11: validate HMAC, approve org, redirect
  app.get('/approvals/approve', async (req, reply) => {
    const { orgId, exp, sig } = req.query as { orgId?: string; exp?: string; sig?: string };
    if (!orgId || !exp || !sig) return reply.code(400).send({ error: 'Missing parameters' });
    const secret = process.env.MAGIC_LINK_SECRET ?? 'fallback-secret';
    const payload = `${orgId}:${exp}`;
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return reply.code(401).send({ error: 'Invalid or tampered link' });
    }
    if (Math.floor(Date.now() / 1000) > parseInt(exp, 10)) {
      return reply.code(410).send({ error: 'Link expired' });
    }
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return reply.code(404).send({ error: 'Organization not found' });
    if (!org.pendingApproval) return reply.redirect(`${process.env.DASHBOARD_URL ?? ''}/admin/approvals?already=approved`);
    await db.update(organizations).set({ pendingApproval: false, approvedAt: new Date() }).where(eq(organizations.id, orgId));
    await db.update(users).set({ pendingApproval: false }).where(and(eq(users.orgId, orgId), isNull(users.deletedAt)));
    const [admin] = await db.select({ email: users.email, name: users.name })
      .from(users).where(and(eq(users.orgId, orgId), eq(users.role, 'pharmacy_admin'), isNull(users.deletedAt))).limit(1);
    const resendKey = process.env.RESEND_API_KEY;
    const senderDomain = process.env.SENDER_DOMAIN ?? 'mydashrx.com';
    const dashUrl = process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
    if (admin && resendKey) {
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: `MyDashRx <noreply@${senderDomain}>`,
          to: admin.email,
          subject: `Welcome to MyDashRx — ${org.name} is approved!`,
          html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px"><h2 style="color:#0F4C81;margin:0 0 8px">You're approved — let's get delivering!</h2><p style="color:#374151;margin:0 0 24px;font-size:15px">Hi ${admin.name}, <strong>${org.name}</strong> is now live on MyDashRx.</p><a href="${dashUrl}/login?welcome=1" style="display:inline-block;background:#0F4C81;color:#fff;text-decoration:none;padding:13px 28px;border-radius:8px;font-size:15px;font-weight:600;">Sign in &amp; start setup →</a></div>`,
        }),
      }).catch((e: unknown) => { console.error('[ADM11] welcome email failed:', e); });
    }
    await logAuditAction('email-link', 'email-approve', 'approve_org', orgId, org.name);
    return reply.redirect(`${dashUrl}/admin/approvals?approved=${orgId}`);
  });

  // GET /admin/users/zero-scope — P-RBAC7: dispatchers/pharmacists with no depot assignments
  app.get('/users/zero-scope', { preHandler: auth }, async () => {
    const zeroScopeUsers = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        orgId: users.orgId,
        orgName: organizations.name,
        createdAt: users.createdAt,
      })
      .from(users)
      .innerJoin(organizations, eq(users.orgId, organizations.id))
      .where(
        and(
          inArray(users.role, ['dispatcher', 'pharmacist']),
          sql`${users.depotIds}::jsonb = '[]'::jsonb`,
          isNull(users.deletedAt),
          eq(organizations.pendingApproval, false),
          isNull(organizations.deletedAt),
        )
      )
      .orderBy(users.createdAt);
    return { count: zeroScopeUsers.length, users: zeroScopeUsers };
  });

  // POST /admin/jobs/approval-reminders — P-CNV1: 90min/4hr re-engagement for pending approvals
  app.post('/jobs/approval-reminders', { preHandler: auth }, async () => {
    const now = new Date();
    const resendKey = process.env.RESEND_API_KEY;
    const senderDomain = process.env.SENDER_DOMAIN ?? 'cartana.life';
    const dashUrl = process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
    let sent = 0;

    const pending = await db.select().from(organizations)
      .where(and(eq(organizations.pendingApproval, true), isNull(organizations.deletedAt)));

    for (const org of pending) {
      const ageMs = now.getTime() - new Date(org.createdAt).getTime();
      const ageMin = ageMs / 60_000;
      const sent90 = (org.approvalReminderSentAt as any)?.t90;
      const sent4h = (org.approvalReminderSentAt as any)?.t4h;

      const [admin] = await db.select({ email: users.email, name: users.name })
        .from(users).where(and(eq(users.orgId, org.id), eq(users.role, 'pharmacy_admin'), isNull(users.deletedAt))).limit(1);
      if (!admin || !resendKey) continue;

      // 90-min touch: 85–95 minutes since signup
      if (ageMin >= 85 && ageMin < 95 && !sent90) {
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({
            from: `MyDashRx <noreply@${senderDomain}>`,
            to: admin.email,
            subject: '[MyDashRx] Your application is being reviewed',
            track_clicks: false,
            html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
              <h2 style="color:#0F4C81;margin:0 0 8px">We're reviewing your application</h2>
              <p style="color:#374151;font-size:15px">Hi ${admin.name}, your application for <strong>${org.name}</strong> is actively being reviewed. Most applications are approved within 2–4 business hours.</p>
              <p style="color:#374151;font-size:15px">While you wait, you can <a href="${dashUrl}/pending-approval">prepare your onboarding checklist</a>.</p>
            </div>`,
          }),
        }).catch((e: unknown) => { console.error('[CNV1] 90min email failed:', e); });
        await db.update(organizations)
          .set({ approvalReminderSentAt: { ...(org.approvalReminderSentAt as object ?? {}), t90: now.toISOString() } })
          .where(eq(organizations.id, org.id));
        sent++;
      }

      // P-ADM10: 24hr admin escalation — email all super_admins when signup pending ≥23hr
      const sentAdminEsc = (org.approvalReminderSentAt as any)?.adminEsc24h;
      if (ageMin >= 23 * 60 && !sentAdminEsc) {
        const superAdmins = await db.select({ email: users.email, name: users.name })
          .from(users)
          .where(and(eq(users.role, 'super_admin'), isNull(users.deletedAt)));
        for (const sa of superAdmins) {
          if (!resendKey) continue;
          fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
            body: JSON.stringify({
              from: `MyDashRx Alerts <noreply@${senderDomain}>`,
              to: sa.email,
              subject: `[ACTION NEEDED] ${org.name} has been waiting 24hr for approval`,
              track_clicks: false,
              html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
                <h2 style="color:#dc2626;margin:0 0 8px">⚠ Pending approval: 24+ hours</h2>
                <p style="color:#374151;font-size:15px">Hi ${sa.name}, <strong>${org.name}</strong> submitted their pharmacy application over 24 hours ago and is still awaiting approval.</p>
                <p style="color:#374151;font-size:15px">Applied by: ${admin.email}</p>
                <a href="${dashUrl}/admin/approvals" style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:600;">Review application →</a>
              </div>`,
            }),
          }).catch((e: unknown) => { console.error('[ADM10] admin escalation email failed:', e); });
        }
        await db.update(organizations)
          .set({ approvalReminderSentAt: { ...(org.approvalReminderSentAt as object ?? {}), adminEsc24h: now.toISOString() } })
          .where(eq(organizations.id, org.id));
        sent++;
      }

      // 4-hour fallback: 235–245 minutes since signup
      if (ageMin >= 235 && ageMin < 245 && !sent4h) {
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({
            from: `MyDashRx <noreply@${senderDomain}>`,
            to: admin.email,
            subject: '[MyDashRx] Still reviewing your application',
            track_clicks: false,
            html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
              <h2 style="color:#0F4C81;margin:0 0 8px">We haven't forgotten you</h2>
              <p style="color:#374151;font-size:15px">Hi ${admin.name}, your application for <strong>${org.name}</strong> is taking a little longer than usual. Our team will reach out personally if we need anything.</p>
              <p style="color:#374151;font-size:15px">Questions? Reply to this email — we respond within 2 hours.</p>
            </div>`,
          }),
        }).catch((e: unknown) => { console.error('[CNV1] 4hr email failed:', e); });
        await db.update(organizations)
          .set({ approvalReminderSentAt: { ...(org.approvalReminderSentAt as object ?? {}), t4h: now.toISOString() } })
          .where(eq(organizations.id, org.id));
        sent++;
      }
    }

    return { sent, checked: pending.length };
  });

  // POST /admin/jobs/cleanup-tokens — P-CLN2 + P-CLN3: Delete expired/used magic link tokens + stale refresh tokens
  app.post('/jobs/cleanup-tokens', { preHandler: auth }, async () => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const deleted = await db.delete(magicLinkTokens).where(
      or(
        lt(magicLinkTokens.expiresAt, cutoff),
        and(isNotNull(magicLinkTokens.usedAt), lt(magicLinkTokens.createdAt, cutoff)),
      )
    ).returning({ id: magicLinkTokens.id });

    // P-CLN3: Delete used/revoked refresh tokens past expiry
    const rtResult = await db.execute(
      sql`DELETE FROM refresh_tokens WHERE (status = 'used' OR status = 'revoked') AND expires_at < NOW() - INTERVAL '1 day' RETURNING id`
    );
    const refreshTokensDeleted = (rtResult as unknown as Array<unknown>).length;

    return { deleted: deleted.length, refreshTokensDeleted };
  });
};
