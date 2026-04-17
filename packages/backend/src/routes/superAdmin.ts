import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { organizations, users, stops, drivers, adminAuditLogs, magicLinkTokens } from '../db/schema.js';
import { eq, isNull, sql, gte, count, and, desc, lt, or, isNotNull } from 'drizzle-orm';
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
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
              <h2 style="color:#0F4C81;margin:0 0 8px">You're approved!</h2>
              <p style="color:#374151;margin:0 0 8px;font-size:15px">Hi ${admin.name},</p>
              <p style="color:#374151;margin:0 0 24px;font-size:15px"><strong>${org.name}</strong> has been approved on MyDashRx. You can now sign in and start managing your deliveries.</p>
              <a href="${dashUrl}/login" style="display:inline-block;background:#0F4C81;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:600;">Sign in to MyDashRx</a>
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

    const now = new Date();
    await db.update(organizations).set({ deletedAt: now }).where(eq(organizations.id, orgId));
    await db.update(users).set({ deletedAt: now }).where(eq(users.orgId, orgId));

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
              <h2 style="color:#374151;margin:0 0 8px">Application update</h2>
              <p style="color:#374151;margin:0 0 8px;font-size:15px">Hi ${admin.name},</p>
              <p style="color:#374151;margin:0 0 8px;font-size:15px">Thank you for applying to MyDashRx. After review, we are unable to approve <strong>${org.name}</strong> at this time.</p>
              ${reason ? `<p style="color:#374151;margin:0 0 16px;font-size:14px;background:#f9fafb;padding:12px;border-radius:8px">${reason}</p>` : ''}
              <p style="color:#6b7280;font-size:13px">If you believe this is an error, contact <a href="mailto:support@mydashrx.com">support@mydashrx.com</a>.</p>
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

  // POST /admin/jobs/cleanup-tokens — P-CLN2: Delete expired/used magic link tokens older than 24hr
  app.post('/jobs/cleanup-tokens', { preHandler: auth }, async () => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const deleted = await db.delete(magicLinkTokens).where(
      or(
        lt(magicLinkTokens.expiresAt, cutoff),
        and(isNotNull(magicLinkTokens.usedAt), lt(magicLinkTokens.createdAt, cutoff)),
      )
    ).returning({ id: magicLinkTokens.id });
    return { deleted: deleted.length };
  });
};
