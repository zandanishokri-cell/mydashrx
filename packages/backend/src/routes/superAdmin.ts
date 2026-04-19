import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { createHmac, timingSafeEqual, createHash } from 'crypto';
import { db } from '../db/connection.js';
import { organizations, users, stops, drivers, adminAuditLogs, auditLogs, magicLinkTokens, refreshTokens, depots, approvalNotes, roleTemplates, plans } from '../db/schema.js';
import { eq, isNull, sql, gte, lte, count, and, desc, asc, lt, or, isNotNull, inArray } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';
import { ROLE_PERMISSIONS } from '@mydash-rx/shared';
import { invalidateOrgRole, invalidateOrg, listTemplates, upsertTemplate, seedOrgDefaults } from '../lib/rbacCache.js';
import { sendOrgApprovalEmail } from '../lib/emailHelpers.js';

// P-ADM39: in-memory SSE client registry for approval queue live updates
const approvalSseClients = new Set<FastifyReply>();

export function notifyApprovalClients(): void {
  for (const reply of approvalSseClients) {
    if (!reply.raw.writableEnded) {
      reply.raw.write('data: {"type":"refresh"}\n\n');
    }
  }
}

// P-ADM40: SLA escalation ladder — HIPAA §164.308(a)(1)(ii)(A) timeliness evidence
const SLA_LADDER = [
  { level: 1, afterHours: 2,  action: 'slack_ping',   message: 'Pending approval needs attention' },
  { level: 2, afterHours: 4,  action: 'slack_urgent', message: 'URGENT: Approval pending 4+ hours' },
  { level: 3, afterHours: 8,  action: 'email_admins', message: 'Approval SLA at risk' },
  { level: 4, afterHours: 24, action: 'sla_breach',   message: 'SLA BREACHED' },
] as const;

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
      db.select({ id: organizations.id, billingPlan: organizations.billingPlan, approvedAt: organizations.approvedAt, activatedAt: organizations.activatedAt, firstDispatchAt: organizations.firstDispatchAt })
        .from(organizations).where(isNull(organizations.deletedAt)),
      db.select({ id: drivers.id }).from(drivers).where(isNull(drivers.deletedAt)),
      db.select({ count: sql<number>`count(*)::int` }).from(stops)
        .where(sql`${stops.createdAt} >= ${since30d} AND ${stops.deletedAt} IS NULL`),
      db.select({ count: sql<number>`count(*)::int` }).from(stops)
        .where(isNull(stops.deletedAt)),
    ]);

    // P-PERF15: collapse 6 sequential independent awaits into one Promise.all.
    // postgres.js v3 uses connection pooling; parallel promises reuse the pool efficiently.
    // Note: drizzle-orm/postgres-js does not expose db.batch() — Promise.all is the correct
    // parallel primitive for this driver. Each query runs on an available pool connection.
    const since7d = new Date(Date.now() - 7 * 86400000);
    const [
      activeOrgRows, topOrgRows, orgNames,
      approvedLast7d, rejectedLast7d, pendingOrgs, approvedWithTime,
    ] = await Promise.all([
      db.select({ orgId: stops.orgId })
        .from(stops)
        .where(sql`${stops.createdAt} >= ${since30d} AND ${stops.deletedAt} IS NULL`)
        .groupBy(stops.orgId),
      db.select({ orgId: stops.orgId, stops30d: sql<number>`count(*)::int` })
        .from(stops)
        .where(sql`${stops.createdAt} >= ${since30d} AND ${stops.deletedAt} IS NULL`)
        .groupBy(stops.orgId)
        .orderBy(sql`count(*) DESC`)
        .limit(5),
      db.select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(isNull(organizations.deletedAt)),
      db.select({ count: sql<number>`count(*)::int` }).from(organizations)
        .where(and(isNull(organizations.deletedAt), sql`${organizations.approvedAt} >= ${since7d.toISOString()}`)),
      db.select({ count: sql<number>`count(*)::int` }).from(organizations)
        .where(and(isNull(organizations.deletedAt), sql`${organizations.rejectedAt} >= ${since7d.toISOString()}`)),
      db.select({ createdAt: organizations.createdAt }).from(organizations)
        .where(and(eq(organizations.pendingApproval, true), isNull(organizations.deletedAt))),
      db.select({ createdAt: organizations.createdAt, approvedAt: organizations.approvedAt })
        .from(organizations).where(and(isNull(organizations.deletedAt), isNotNull(organizations.approvedAt))),
    ]);

    const nameMap = Object.fromEntries(orgNames.map(o => [o.id, o.name]));
    const revenueEstimate = allOrgs.reduce((sum, o) => sum + (PLAN_PRICES[o.billingPlan] ?? 0), 0);

    // P-ADM12: approval funnel health
    const nowMs = Date.now();
    const pendingOver24h = pendingOrgs.filter(o => nowMs - new Date(o.createdAt).getTime() > 24 * 3600_000).length;
    const hoursArr = approvedWithTime
      .filter(o => o.approvedAt)
      .map(o => (new Date(o.approvedAt!).getTime() - new Date(o.createdAt).getTime()) / 3600_000);
    const avgHoursToApproval = hoursArr.length ? Math.round(hoursArr.reduce((s, h) => s + h, 0) / hoursArr.length * 10) / 10 : null;

    // P-ONB38: avgActivationHours — hours from approvedAt to first dispatch (firstDispatchAt)
    // firstDispatchAt = first route→active, more accurate TTV than first stop created
    const activationTimes = allOrgs
      .filter(o => o.approvedAt && o.firstDispatchAt)
      .map(o => (new Date(o.firstDispatchAt!).getTime() - new Date(o.approvedAt!).getTime()) / 3600_000);
    const avgActivationHours = activationTimes.length
      ? Math.round(activationTimes.reduce((s, h) => s + h, 0) / activationTimes.length * 10) / 10
      : null;

    // P-ONB44: activation funnel step drop-off — orgs that reached each setup milestone
    const approvedOrgIds = allOrgs.filter(o => o.approvedAt).map(o => o.id);
    const signedUp = allOrgs.length;
    const approved = approvedOrgIds.length;

    const [depotOrgs, driverOrgs, planOrgs] = approvedOrgIds.length > 0
      ? await Promise.all([
          db.selectDistinct({ orgId: depots.orgId }).from(depots)
            .where(and(isNull(depots.deletedAt), inArray(depots.orgId, approvedOrgIds))),
          db.selectDistinct({ orgId: drivers.orgId }).from(drivers)
            .where(and(isNull(drivers.deletedAt), inArray(drivers.orgId, approvedOrgIds))),
          db.selectDistinct({ orgId: plans.orgId }).from(plans)
            .where(and(isNull(plans.deletedAt), inArray(plans.orgId, approvedOrgIds))),
        ])
      : [[], [], []];

    const firstDispatchedCount = allOrgs.filter(o => o.firstDispatchAt).length;

    const activationFunnel = {
      signedUp,
      approved,
      hasDepot: depotOrgs.length,
      hasDriver: driverOrgs.length,
      hasPlan: planOrgs.length,
      hasDispatched: firstDispatchedCount,
    };

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
      activationHealth: {
        avgActivationHours,
        activatedOrgs: activationTimes.length,
        unactivatedOrgs: allOrgs.filter(o => o.approvedAt && !o.firstDispatchAt).length,
      },
      activationFunnel,
    };
  });

  // GET /admin/orgs
  // P-PERF16: column projection (14 cols only) + keyset cursor pagination (LIMIT 50).
  // Replaces SELECT * with no LIMIT — eliminates ~1.5MB payload at 500 orgs.
  // HIPAA §164.502(b) minimum-necessary: strips PHI-adjacent fields not needed by list UI.
  // Cursor: base64url JSON {createdAt, id} for stable keyset pagination.
  // Audit: admin_org_list_viewed logged per HIPAA §164.502(b).
  app.get('/orgs', { preHandler: auth }, async (req, reply) => {
    const actor = req.user as { sub: string; email: string };
    const q = req.query as { cursor?: string; status?: string };
    const LIMIT = 50;

    // Decode cursor
    let cursorTs: Date | null = null;
    let cursorId: string | null = null;
    if (q.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(q.cursor, 'base64url').toString('utf8')) as { createdAt: string; id: string };
        cursorTs = new Date(decoded.createdAt);
        cursorId = decoded.id;
      } catch { return reply.code(400).send({ error: 'Invalid cursor' }); }
    }

    // Build WHERE clause (keyset: fetch rows AFTER cursor position)
    const whereClause = and(
      isNull(organizations.deletedAt),
      cursorTs && cursorId
        ? or(
            lt(organizations.createdAt, cursorTs),
            and(eq(organizations.createdAt, cursorTs), lt(organizations.id, cursorId)),
          )
        : undefined,
    );

    // P-PERF16: project only 14 columns — HIPAA minimum-necessary
    const orgs = await db.select({
      id: organizations.id,
      name: organizations.name,
      billingPlan: organizations.billingPlan,
      pendingApproval: organizations.pendingApproval,
      approvedAt: organizations.approvedAt,
      createdAt: organizations.createdAt,
      onboardingStep: organizations.onboardingStep,
      slaBreachedAt: organizations.slaBreachedAt,
      escalationLevel: organizations.escalationLevel,
      baaAcceptedAt: organizations.baaAcceptedAt,
      npiNumber: organizations.npiNumber,
      riskScore: organizations.riskScore,
      trustTier: organizations.trustTier,
      assignedReviewerId: organizations.assignedReviewerId,
      firstDispatchedAt: organizations.firstDispatchedAt,
      lastDispatchedAt: organizations.lastDispatchedAt,
    })
      .from(organizations)
      .where(whereClause)
      .orderBy(desc(organizations.createdAt), desc(organizations.id))
      .limit(LIMIT + 1); // fetch one extra to detect hasMore

    const hasMore = orgs.length > LIMIT;
    const page = hasMore ? orgs.slice(0, LIMIT) : orgs;

    // Build next cursor from last item in page
    const last = page[page.length - 1];
    const nextCursor = last && hasMore
      ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString('base64url')
      : null;

    // HIPAA §164.502(b) audit — log every admin org list view
    db.insert(adminAuditLogs).values({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'admin_org_list_viewed',
      targetId: 'system',
      targetName: 'org_list',
      metadata: { cursor: q.cursor ?? null, resultCount: page.length },
    }).catch((e: unknown) => { console.error('[AuditLog] admin_org_list_viewed failed:', e); });

    return { orgs: page, nextCursor, hasMore };
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
  // P-ADM33: fixed N+1 (was 2N+1 queries) → 3 parallel queries total via JOIN+aggregate
  app.get('/approvals', { preHandler: auth }, async () => {
    const [pendingOrgs, adminRows, noteRows] = await Promise.all([
      db.select().from(organizations)
        .where(and(eq(organizations.pendingApproval, true), isNull(organizations.deletedAt)))
        .orderBy(organizations.createdAt),
      db.select({ orgId: users.orgId, id: users.id, name: users.name, email: users.email, createdAt: users.createdAt })
        .from(users)
        .innerJoin(organizations, eq(users.orgId, organizations.id))
        .where(and(eq(users.role, 'pharmacy_admin'), eq(organizations.pendingApproval, true), isNull(users.deletedAt), isNull(organizations.deletedAt))),
      db.select({ orgId: approvalNotes.orgId, cnt: sql<number>`count(*)::int` })
        .from(approvalNotes)
        .innerJoin(organizations, eq(approvalNotes.orgId, organizations.id))
        .where(and(eq(organizations.pendingApproval, true), isNull(organizations.deletedAt)))
        .groupBy(approvalNotes.orgId),
    ]);

    const adminMap = new Map(adminRows.map(a => [a.orgId, a]));
    const noteMap = new Map(noteRows.map(n => [n.orgId, n.cnt]));

    // P-ADM37: resolve assignee initials for list row badge
    const assigneeIds = [...new Set(pendingOrgs.map(o => o.assignedReviewerId).filter(Boolean))] as string[];
    const assigneeMap = new Map<string, { name: string; email: string }>();
    if (assigneeIds.length) {
      const assignees = await db.select({ id: users.id, name: users.name, email: users.email })
        .from(users).where(inArray(users.id, assigneeIds));
      assignees.forEach(a => assigneeMap.set(a.id, { name: a.name, email: a.email }));
    }

    return pendingOrgs.map(org => ({
      org: {
        ...org,
        noteCount: noteMap.get(org.id) ?? 0,
        assignee: org.assignedReviewerId ? (assigneeMap.get(org.assignedReviewerId) ?? null) : null,
      },
      admin: adminMap.get(org.id) ?? null,
    }));
  });

  // POST /admin/approvals/:orgId/approve
  app.post('/approvals/:orgId/approve', { preHandler: auth }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return reply.code(404).send({ error: 'Organization not found' });

    await db.update(organizations).set({ pendingApproval: false, approvedAt: new Date() }).where(eq(organizations.id, orgId));
    await db.update(users).set({ pendingApproval: false }).where(and(eq(users.orgId, orgId), isNull(users.deletedAt)));

    // P-ADM26: send welcome email via shared helper
    const [admin] = await db.select({ email: users.email, name: users.name })
      .from(users).where(and(eq(users.orgId, orgId), eq(users.role, 'pharmacy_admin'), isNull(users.deletedAt))).limit(1);
    if (admin) sendOrgApprovalEmail(orgId, org.name, admin.email, admin.name);

    const actor = req.user as { sub: string; email: string };
    await logAuditAction(actor.sub, actor.email, 'approve_org', orgId, org.name);

    // P-RBAC23: ensure org has isolated role templates (idempotent — ON CONFLICT DO NOTHING)
    seedOrgDefaults(orgId).catch((e: unknown) => { console.error('[P-RBAC23] seedOrgDefaults on approve failed:', e); });

    notifyApprovalClients(); // P-ADM39: push refresh to all SSE subscribers

    return { success: true, orgId };
  });

  // POST /admin/approvals/:orgId/reject
  app.post('/approvals/:orgId/reject', {
    preHandler: auth,
    schema: {
      body: {
        type: 'object',
        properties: {
          reason: { type: 'string', enum: ['missing_license_proof', 'invalid_npi', 'high_fraud_risk', 'incomplete_application', 'duplicate_account', 'service_area', 'other'] },
          note: { type: 'string', maxLength: 1000 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const { reason, note } = (req.body as { reason?: string; note?: string }) ?? {};

    const VALID_REASONS = [
      'missing_license_proof', 'invalid_npi', 'high_fraud_risk',
      'incomplete_application', 'duplicate_account', 'service_area', 'other',
    ];
    if (reason && !VALID_REASONS.includes(reason)) {
      return reply.code(400).send({ error: `Invalid rejection reason. Must be one of: ${VALID_REASONS.join(', ')}` });
    }

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return reply.code(404).send({ error: 'Organization not found' });

    await db.update(organizations)
      .set({ pendingApproval: false, rejectedAt: new Date(), rejectionReason: reason ?? null, rejectionNote: note ?? null })
      .where(eq(organizations.id, orgId));

    const [admin] = await db.select({ email: users.email, name: users.name })
      .from(users).where(eq(users.orgId, orgId)).limit(1);

    const resendKey = process.env.RESEND_API_KEY;
    const senderDomain = process.env.SENDER_DOMAIN ?? 'mydashrx.com';

    const RECOVERY_GUIDANCE: Record<string, { heading: string; body: string }> = {
      missing_license_proof: {
        heading: 'Pharmacy license documentation is required',
        body: 'Please upload a copy of your state pharmacy license and DEA registration. Once you have these documents ready, you can reapply and we\'ll review within 24 hours.',
      },
      invalid_npi: {
        heading: 'We couldn\'t verify your NPI number',
        body: 'Your NPI didn\'t match records in the NPPES database. Please verify your NPI at npiregistry.cms.hhs.gov and reapply with the correct number.',
      },
      high_fraud_risk: {
        heading: 'Your application requires additional verification',
        body: 'Your application was flagged for additional review. Please contact us at compliance@mydashrx.com to resolve this directly. We respond within 2 business hours.',
      },
      incomplete_application: {
        heading: 'Your application is missing required information',
        body: 'Please complete all required fields and reapply. If you need help identifying what\'s missing, contact support@mydashrx.com.',
      },
      duplicate_account: {
        heading: 'An account already exists for this pharmacy',
        body: 'It looks like your pharmacy already has a MyDashRx account. Please contact support@mydashrx.com and we\'ll help you access your existing account.',
      },
      service_area: {
        heading: 'Your pharmacy is outside our current service area',
        body: 'MyDashRx currently serves pharmacies in Michigan. We\'re expanding — sign up for our waitlist at mydashrx.com and we\'ll notify you when we reach your area.',
      },
      other: {
        heading: 'Your application was not approved',
        body: 'Please contact support@mydashrx.com for more information. We respond within 2 business hours.',
      },
    };

    const guidance = reason ? RECOVERY_GUIDANCE[reason] : null;

    if (admin && resendKey) {
      // P-ADM28: generate HMAC reapply link (48hr expiry)
      const reapplySecret = process.env.MAGIC_LINK_SECRET ?? 'fallback-secret';
      const reapplyExp = Math.floor(Date.now() / 1000) + 48 * 3600;
      const reapplyPayload = `reapply:${orgId}:${reapplyExp}`;
      const reaplySig = createHmac('sha256', reapplySecret).update(reapplyPayload).digest('hex');
      const dashUrl = process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
      const reapplyUrl = `${dashUrl}/reapply?orgId=${orgId}&exp=${reapplyExp}&sig=${reaplySig}`;

      const reasonLabel: Record<string, string> = {
        missing_license_proof: 'Missing pharmacy license documentation',
        invalid_npi: 'NPI number could not be verified',
        high_fraud_risk: 'Application flagged for additional verification',
        incomplete_application: 'Application information incomplete',
        duplicate_account: 'Account already exists for this pharmacy',
        service_area: 'Outside current service area',
        other: 'See note below',
      };
      // Show reapply CTA for fixable reasons; hide for non-fixable (duplicate, service_area)
      const showReapply = !['duplicate_account', 'service_area'].includes(reason ?? '');
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: `MyDashRx <noreply@${senderDomain}>`,
          to: admin.email,
          reply_to: 'support@mydashrx.com',
          subject: `MyDashRx — Application update for ${org.name}`,
          // P-DEL13: suppress tracking — reapply links in rejection emails must not be scanner-consumed
          track_clicks: false,
          track_opens: false,
          // P-DEL17: Gmail postmaster stream bucketing
          headers: { 'Feedback-ID': 'rejection:mydashrx:resend:transactional' },
          html: `
            <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Update on your MyDashRx application for ${org.name} — review next steps.</span>
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
              <h2 style="color:#374151;margin:0 0 8px">Update on your MyDashRx application</h2>
              <p style="color:#374151;margin:0 0 8px;font-size:15px">Hi ${admin.name},</p>
              <p style="color:#374151;margin:0 0 16px;font-size:15px">We reviewed the application for <strong>${org.name}</strong> and are unable to approve it at this time.</p>
              ${reason ? `<div style="background:#fef9ec;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-bottom:16px">
                <p style="color:#92400e;font-size:13px;font-weight:600;margin:0 0 4px">Reason: ${reasonLabel[reason] ?? reason}</p>
                ${guidance ? `<p style="color:#78350f;font-size:14px;margin:8px 0 0"><strong>${guidance.heading}</strong><br>${guidance.body}</p>` : ''}
                ${note ? `<p style="color:#78350f;font-size:13px;margin:8px 0 0;border-top:1px solid #fde68a;padding-top:8px">Additional note: ${note}</p>` : ''}
              </div>` : ''}
              ${showReapply ? `<a href="${reapplyUrl}" style="display:inline-block;background:#0F4C81;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;margin-bottom:16px">Reapply now →</a><p style="color:#9ca3af;font-size:11px;margin:0 0 16px">Reapply link expires in 48 hours.</p>` : ''}
              <p style="color:#6b7280;font-size:14px;margin:0 0 8px">Questions? Reply to this email or contact <a href="mailto:support@mydashrx.com" style="color:#0F4C81">support@mydashrx.com</a>. We respond within 2 business hours.</p>
              <p style="color:#9ca3af;font-size:12px;margin-top:24px">Application ref: ${orgId}</p>
            </div>`,
        }),
      }).catch((e: unknown) => { console.error('[Resend] rejection email failed:', e); });
    }

    const actor = req.user as { sub: string; email: string };
    await logAuditAction(actor.sub, actor.email, 'reject_org', orgId, org.name, { reason: reason ?? null, note: note ?? null });

    notifyApprovalClients(); // P-ADM39

    return { success: true, orgId };
  });

  // POST /admin/approvals/batch — batch approve or reject
  // POST /admin/approvals/batch — P-ADM34: direct DB transaction, no app.inject HTTP round-trips
  app.post('/approvals/batch', { preHandler: auth }, async (req, reply) => {
    const { orgIds, action, reason, note } = req.body as { orgIds?: string[]; action?: 'approve' | 'reject'; reason?: string; note?: string };
    if (!Array.isArray(orgIds) || orgIds.length === 0) return reply.code(400).send({ error: 'orgIds array required' });
    if (action !== 'approve' && action !== 'reject') return reply.code(400).send({ error: 'action must be approve or reject' });

    const actor = req.user as { sub: string; email: string };
    const now = new Date();

    // Fetch orgs in one query to validate existence + get names for audit
    const orgs = await db.select({ id: organizations.id, name: organizations.name })
      .from(organizations).where(and(inArray(organizations.id, orgIds), isNull(organizations.deletedAt)));
    const foundIds = orgs.map(o => o.id);
    if (foundIds.length === 0) return reply.code(404).send({ error: 'No valid orgs found' });

    // Single bulk DB update
    if (action === 'approve') {
      await db.update(organizations)
        .set({ pendingApproval: false, approvedAt: now })
        .where(inArray(organizations.id, foundIds));
      await db.update(users)
        .set({ pendingApproval: false })
        .where(and(inArray(users.orgId, foundIds), isNull(users.deletedAt)));
    } else {
      const VALID_REASONS = ['missing_license_proof', 'invalid_npi', 'high_fraud_risk', 'incomplete_application', 'duplicate_account', 'service_area', 'other'];
      if (reason && !VALID_REASONS.includes(reason)) return reply.code(400).send({ error: `Invalid reason` });
      await db.update(organizations)
        .set({ pendingApproval: false, rejectedAt: now, rejectionReason: reason ?? null, rejectionNote: note ?? null })
        .where(inArray(organizations.id, foundIds));
    }

    // Fetch admins for emails in one query
    const admins = await db.select({ orgId: users.orgId, email: users.email, name: users.name })
      .from(users).where(and(inArray(users.orgId, foundIds), eq(users.role, 'pharmacy_admin'), isNull(users.deletedAt)));
    const adminMap = new Map(admins.map(a => [a.orgId, a]));

    // Fire-and-forget emails + audit logs (allSettled — never block response on email failures)
    const orgMap = new Map(orgs.map(o => [o.id, o]));
    await Promise.allSettled(foundIds.flatMap(orgId => {
      const org = orgMap.get(orgId)!;
      const admin = adminMap.get(orgId);
      const tasks: Promise<unknown>[] = [
        logAuditAction(actor.sub, actor.email, action === 'approve' ? 'approve_org' : 'reject_org', orgId, org.name, { batch: true, reason: reason ?? null }),
      ];
      if (action === 'approve' && admin) {
        tasks.push(sendOrgApprovalEmail(orgId, org.name, admin.email, admin.name));
      }
      return tasks;
    }));

    notifyApprovalClients(); // P-ADM39

    return { success: true, processed: foundIds.length, notFound: orgIds.length - foundIds.length };
  });

  // POST /admin/approvals/:orgId/hold — P-ADM20: put org on hold, request more info
  app.post('/approvals/:orgId/hold', { preHandler: auth }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const { holdReason } = (req.body as { holdReason?: string }) ?? {};
    if (!holdReason?.trim()) return reply.code(400).send({ error: 'holdReason required' });

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return reply.code(404).send({ error: 'Organization not found' });

    await db.update(organizations)
      .set({ onHold: true, holdReason: holdReason.trim(), holdRequestedAt: new Date() })
      .where(eq(organizations.id, orgId));

    // Email pharmacy admin to request more info
    const [admin] = await db.select({ email: users.email, name: users.name })
      .from(users).where(and(eq(users.orgId, orgId), eq(users.role, 'pharmacy_admin'), isNull(users.deletedAt))).limit(1);
    const resendKey = process.env.RESEND_API_KEY;
    const senderDomain = process.env.SENDER_DOMAIN ?? 'mydashrx.com';
    if (admin && resendKey) {
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: `MyDashRx <noreply@${senderDomain}>`,
          to: admin.email,
          reply_to: 'support@mydashrx.com',
          subject: `[MyDashRx] Additional information needed for ${org.name}`,
          // P-DEL13: suppress tracking — admin emails must not go through Resend CDN
          track_clicks: false,
          track_opens: false,
          // P-DEL17: Gmail postmaster stream bucketing
          headers: { 'Feedback-ID': 'hold-request:mydashrx:resend:transactional' },
          html: `<span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">We need a little more information to complete your MyDashRx application review.</span><div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
            <h2 style="color:#374151;margin:0 0 8px">Additional information needed</h2>
            <p style="color:#374151;font-size:15px">Hi ${admin.name}, we're reviewing your application for <strong>${org.name}</strong> and need a bit more information before we can proceed.</p>
            <div style="background:#fef9ec;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin:16px 0">
              <p style="color:#78350f;font-size:14px;margin:0"><strong>What we need:</strong><br>${holdReason}</p>
            </div>
            <p style="color:#374151;font-size:15px">Please reply to this email with the requested information and we'll complete your review within 24 hours.</p>
            <p style="color:#6b7280;font-size:13px;margin-top:16px">Application ref: ${orgId}</p>
          </div>`,
        }),
      }).catch((e: unknown) => { console.error('[ADM20] hold email failed:', e); });
    }

    const actor = req.user as { sub: string; email: string };
    await logAuditAction(actor.sub, actor.email, 'put_on_hold', orgId, org.name, { holdReason });
    return { success: true, orgId };
  });

  // DELETE /admin/approvals/:orgId/hold — P-ADM20: release hold
  app.delete('/approvals/:orgId/hold', { preHandler: auth }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return reply.code(404).send({ error: 'Organization not found' });
    await db.update(organizations).set({ onHold: false, holdReason: null, holdRequestedAt: null }).where(eq(organizations.id, orgId));
    const actor = req.user as { sub: string; email: string };
    await logAuditAction(actor.sub, actor.email, 'release_hold', orgId, org.name);
    return { success: true };
  });

  // GET /admin/approvals/:orgId/notes — P-ADM19: list internal notes
  app.get('/approvals/:orgId/notes', { preHandler: auth }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    return db.select().from(approvalNotes)
      .where(eq(approvalNotes.orgId, orgId))
      .orderBy(desc(approvalNotes.createdAt));
  });

  // POST /admin/approvals/:orgId/notes — P-ADM19: add internal note
  app.post('/approvals/:orgId/notes', { preHandler: auth }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const { content } = (req.body as { content?: string }) ?? {};
    if (!content?.trim()) return reply.code(400).send({ error: 'content required' });
    const actor = req.user as { sub: string; email: string };
    const [note] = await db.insert(approvalNotes).values({
      orgId, adminId: actor.sub, adminEmail: actor.email, content: content.trim(),
    }).returning();
    return note;
  });

  // DELETE /admin/approvals/:orgId/notes/:noteId — P-ADM19: delete own note
  app.delete('/approvals/:orgId/notes/:noteId', { preHandler: auth }, async (req, reply) => {
    const { orgId, noteId } = req.params as { orgId: string; noteId: string };
    const actor = req.user as { sub: string; email: string };
    const [note] = await db.select().from(approvalNotes)
      .where(and(eq(approvalNotes.id, noteId), eq(approvalNotes.orgId, orgId))).limit(1);
    if (!note) return reply.code(404).send({ error: 'Note not found' });
    if (note.adminId !== actor.sub) return reply.code(403).send({ error: 'Can only delete your own notes' });
    await db.delete(approvalNotes).where(eq(approvalNotes.id, noteId));
    return { success: true };
  });

  // PATCH /admin/approvals/:orgId/assign — P-ADM37: self-assign as reviewer, notify via email
  app.patch('/approvals/:orgId/assign', { preHandler: auth }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const actor = req.user as { sub: string; email: string; name?: string };

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return reply.code(404).send({ error: 'Organization not found' });

    await db.update(organizations)
      .set({ assignedReviewerId: actor.sub, assignedAt: new Date() })
      .where(eq(organizations.id, orgId));

    // Audit log — HIPAA §164.308(a)(3)(ii)(A)
    await logAuditAction(actor.sub, actor.email, 'reviewer_assigned', orgId, org.name, {
      assignedTo: actor.sub, assignedEmail: actor.email,
    });

    // Fire-and-forget: send notification email to assignee with HMAC approve link (P-ADM11 pattern)
    const secret = process.env.MAGIC_LINK_SECRET ?? 'fallback-secret';
    const exp = Math.floor(Date.now() / 1000) + 48 * 3600;
    const payload = `${orgId}:${exp}`;
    const sig = createHmac('sha256', secret).update(payload).digest('hex');
    const dashUrl = process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
    const approveLink = `${dashUrl}/admin/approve?orgId=${orgId}&exp=${exp}&sig=${sig}`;
    const reviewLink = `${dashUrl}/admin/approvals`;

    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY ?? ''}` },
      body: JSON.stringify({
        from: process.env.SENDER_DOMAIN ? `MyDashRx <noreply@${process.env.SENDER_DOMAIN}>` : 'MyDashRx <noreply@cartana.life>',
        to: [actor.email],
        subject: `[Assigned] ${org.name} — review request`,
        html: `<p>You have been assigned as reviewer for <strong>${org.name}</strong>.</p>
               <p><a href="${reviewLink}">Review queue →</a></p>
               <p><a href="${approveLink}">One-click approve (48hr link) →</a></p>
               <p style="color:#666;font-size:12px;">This link is single-use and expires in 48 hours.</p>`,
        headers: { 'Feedback-ID': 'stream:mydashrx:resend:admin-assign' },
        tags: [{ name: 'event', value: 'reviewer_assigned' }],
      }),
    }).catch(e => console.error('[P-ADM37] notify email failed:', e));

    return { success: true, assignedReviewerId: actor.sub, assignedAt: new Date() };
  });

  // GET /admin/approvals/export — P-ADM36: HIPAA §164.308(a)(1)(ii)(D) approval decisions CSV
  app.get('/approvals/export', { preHandler: auth }, async (req, reply) => {
    const { format } = req.query as { format?: string };
    const actor = req.user as { sub: string; email: string };

    // Join orgs + their admin user + most recent audit action (approve/reject)
    const rows = await db.execute(sql`
      SELECT
        o.id                    AS org_id,
        o.name                  AS org_name,
        u.email                 AS admin_email,
        o.npi_number,
        o.npi_verified,
        o.risk_score,
        o.trust_tier,
        o.billing_plan,
        o.approved_at,
        o.rejected_at,
        o.rejection_reason,
        o.auto_approved_at,
        o.reapplied_at,
        o.sla_breached_at,
        o.escalation_level,
        o.created_at            AS applied_at,
        a.action                AS decision_action,
        a.actor_email           AS actor_email,
        a.created_at            AS decided_at,
        a.metadata              AS decision_metadata
      FROM organizations o
      LEFT JOIN users u ON u.org_id = o.id AND u.role = 'pharmacy_admin' AND u.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT action, actor_email, created_at, metadata
        FROM admin_audit_logs
        WHERE target_id = o.id AND action IN ('approve_org', 'reject_org', 'auto_approved')
        ORDER BY created_at DESC
        LIMIT 1
      ) a ON true
      WHERE o.deleted_at IS NULL
        AND (o.approved_at IS NOT NULL OR o.rejected_at IS NOT NULL OR o.pending_approval = true)
      ORDER BY o.created_at DESC
      LIMIT 2000
    `);

    const rowArr = rows as unknown as Record<string, unknown>[];

    // Audit-log the export itself (HIPAA §164.308(a)(1)(ii)(D))
    await logAuditAction(actor.sub, actor.email, 'approvals_export', actor.sub, actor.email, {
      format: format ?? 'json', rowCount: rowArr.length,
    });

    if (format === 'csv') {
      const cols = [
        'org_id', 'org_name', 'admin_email', 'npi_number', 'npi_verified',
        'risk_score', 'trust_tier', 'billing_plan',
        'decision_action', 'actor_email', 'decided_at', 'rejection_reason',
        'applied_at', 'auto_approved_at', 'sla_breached_at', 'escalation_level',
      ];
      const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csvHeader = cols.join(',') + '\n';
      const csvBody = rowArr.map(r => cols.map(c => escape(r[c])).join(',')).join('\n');
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="approval-decisions-${new Date().toISOString().slice(0,10)}.csv"`);
      return reply.send(csvHeader + csvBody);
    }

    return rowArr;
  });

  // GET /admin/audit-log — filterable audit trail (HIPAA §164.312(b))
  // P-PERF11: keyset cursor pagination — no OFFSET full-table scan
  app.get('/audit-log', { preHandler: auth }, async (req, reply) => {
    const { eventTypes, actorEmail, from, to, format, limit: limitStr, cursor } = req.query as {
      eventTypes?: string; actorEmail?: string; from?: string; to?: string;
      format?: string; limit?: string; cursor?: string;
    };

    const conditions: any[] = [];
    if (eventTypes) {
      const types = eventTypes.split(',').map(t => t.trim()).filter(Boolean);
      if (types.length) conditions.push(inArray(adminAuditLogs.action, types));
    }
    if (actorEmail) {
      conditions.push(sql`${adminAuditLogs.actorEmail} ILIKE ${'%' + actorEmail + '%'}`);
    }
    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) conditions.push(gte(adminAuditLogs.createdAt, fromDate));
    }
    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate.getTime())) conditions.push(lte(adminAuditLogs.createdAt, toDate));
    }
    if (cursor) {
      try {
        const { created_at, id } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { created_at: string; id: string };
        conditions.push(sql`(${adminAuditLogs.createdAt}, ${adminAuditLogs.id}) < (${new Date(created_at)}::timestamptz, ${id}::uuid)`);
      } catch { /* invalid cursor — return first page */ }
    }

    const pageLimit = Math.min(parseInt(limitStr ?? '100', 10), 500);

    const rows = await db.select().from(adminAuditLogs)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(adminAuditLogs.createdAt))
      .limit(pageLimit + 1); // fetch extra to detect hasMore

    const hasMore = rows.length > pageLimit;
    const events = rows.slice(0, pageLimit);

    if (format === 'csv') {
      // P-SEC11: CSV export itself is an auditable event (HIPAA)
      const actor = (req as any).user as { sub: string; email: string };
      await db.insert(adminAuditLogs).values({
        actorId: actor.sub,
        actorEmail: actor.email,
        action: 'audit_log_exported',
        targetId: actor.sub,
        targetName: actor.email,
        metadata: { eventTypes: eventTypes ?? 'all', actorEmail: actorEmail ?? 'all', from: from ?? null, to: to ?? null, rowCount: events.length },
      }).catch(() => {});

      const csvHeader = 'id,action,actorEmail,targetName,createdAt,metadata\n';
      const csvRows = events.map(r =>
        `"${r.id}","${r.action}","${r.actorEmail}","${r.targetName}","${r.createdAt?.toISOString() ?? ''}","${JSON.stringify(r.metadata ?? {}).replace(/"/g, '""')}"`
      ).join('\n');
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0,10)}.csv"`);
      return reply.send(csvHeader + csvRows);
    }

    const last = events[events.length - 1];
    const nextCursor = hasMore && last
      ? Buffer.from(JSON.stringify({ created_at: last.createdAt?.toISOString(), id: last.id })).toString('base64url')
      : null;

    return { events, nextCursor, hasMore };
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
    if (admin) sendOrgApprovalEmail(orgId, org.name, admin.email, admin.name);
    await logAuditAction('email-link', 'email-approve', 'approve_org', orgId, org.name);
    // P-RBAC23: seed org-specific templates on approval (idempotent)
    seedOrgDefaults(orgId).catch((e: unknown) => { console.error('[P-RBAC23] seedOrgDefaults on link-approve failed:', e); });
    const dashUrl = process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
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
          sql`(users.depot_ids = '[]'::jsonb OR users.depot_ids = '"[]"'::jsonb)`,
          isNull(users.deletedAt),
          eq(organizations.pendingApproval, false),
          isNull(organizations.deletedAt),
        )
      )
      .orderBy(users.createdAt);
    return { count: zeroScopeUsers.length, users: zeroScopeUsers };
  });

  // POST /admin/jobs/approval-reminders — P-ADM40: 4-level chainable SLA escalation ladder
  // HIPAA §164.308(a)(1)(ii)(A) — machine-readable access authorization timeliness evidence
  app.post('/jobs/approval-reminders', { preHandler: auth }, async () => {
    const now = new Date();
    const resendKey = process.env.RESEND_API_KEY;
    const senderDomain = process.env.SENDER_DOMAIN ?? 'cartana.life';
    const dashUrl = process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
    const slackWebhook = process.env.SLACK_WEBHOOK_URL;
    let sent = 0;

    const pending = await db.select().from(organizations)
      .where(and(eq(organizations.pendingApproval, true), isNull(organizations.deletedAt)));

    for (const org of pending) {
      const ageHrs = (now.getTime() - new Date(org.createdAt).getTime()) / 3600_000;
      const currentLevel = org.escalationLevel ?? 0;

      const [admin] = await db.select({ email: users.email, name: users.name })
        .from(users).where(and(eq(users.orgId, org.id), eq(users.role, 'pharmacy_admin'), isNull(users.deletedAt))).limit(1);
      if (!admin) continue;

      // Find the highest ladder step that should have fired but hasn't yet
      for (const step of SLA_LADDER) {
        if (step.level <= currentLevel) continue; // already sent this level
        if (ageHrs < step.afterHours) break; // not time yet — steps are ordered

        if (step.action === 'slack_ping' || step.action === 'slack_urgent') {
          if (slackWebhook) {
            const urgent = step.action === 'slack_urgent';
            fetch(slackWebhook, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                blocks: [
                  { type: 'header', text: { type: 'plain_text', text: `${urgent ? '🚨 URGENT' : '⏰'}: ${step.message} — ${org.name}` } },
                  { type: 'section', text: { type: 'mrkdwn', text: `*${org.name}* has been pending approval for *${Math.round(ageHrs)}h*.\nApplied by: ${admin.email}` } },
                  { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Review in Dashboard' }, url: `${dashUrl}/admin/approvals`, style: urgent ? 'danger' : 'primary' }] },
                ],
              }),
            }).catch((e: unknown) => { console.error(`[ADM40] Slack L${step.level} failed:`, e); });
            sent++;
          }
        } else if (step.action === 'email_admins' && resendKey) {
          const superAdmins = await db.select({ email: users.email, name: users.name })
            .from(users).where(and(eq(users.role, 'super_admin'), isNull(users.deletedAt)));
          for (const sa of superAdmins) {
            fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
              body: JSON.stringify({
                from: `MyDashRx Alerts <noreply@${senderDomain}>`,
                to: sa.email,
                reply_to: 'support@mydashrx.com',
                subject: `[SLA RISK] ${org.name} — ${Math.round(ageHrs)}h without approval`,
                track_clicks: false,
                headers: { 'Feedback-ID': 'admin-escalation:mydashrx:resend:transactional' },
                html: `<span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${step.message}: ${org.name} has been pending ${Math.round(ageHrs)} hours.</span>
                  <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
                    <h2 style="color:#dc2626;margin:0 0 8px">Approval SLA at risk</h2>
                    <p style="color:#374151;font-size:15px">Hi ${sa.name}, <strong>${org.name}</strong> has been pending approval for <strong>${Math.round(ageHrs)} hours</strong>.</p>
                    <p style="color:#374151;font-size:15px">Applied by: ${admin.email}</p>
                    <a href="${dashUrl}/admin/approvals" style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:600;">Review application →</a>
                  </div>`,
              }),
            }).catch((e: unknown) => { console.error(`[ADM40] email_admins L${step.level} failed:`, e); });
          }
          sent++;
        } else if (step.action === 'sla_breach') {
          // Level 4: set slaBreachedAt + audit log — HIPAA timeliness evidence
          const now_ = new Date();
          await db.update(organizations)
            .set({ slaBreachedAt: now_, escalationLevel: step.level })
            .where(eq(organizations.id, org.id));
          await db.insert(adminAuditLogs).values({
            actorId: 'system',
            actorEmail: 'system@mydashrx.com',
            action: 'sla_breach',
            targetId: org.id,
            targetName: org.name,
            metadata: { hoursElapsed: Math.round(ageHrs), adminEmail: admin.email },
          }).catch(() => {});
          // Also Slack-notify
          if (slackWebhook) {
            fetch(slackWebhook, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                blocks: [
                  { type: 'header', text: { type: 'plain_text', text: `🔴 SLA BREACHED — ${org.name}` } },
                  { type: 'section', text: { type: 'mrkdwn', text: `*${org.name}* has exceeded the 24-hour approval SLA.\nPending for *${Math.round(ageHrs)} hours*. Breach logged for HIPAA compliance.` } },
                  { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Review NOW' }, url: `${dashUrl}/admin/approvals`, style: 'danger' }] },
                ],
              }),
            }).catch(() => {});
          }
          sent++;
          break; // level 4 is the max — no need to check further
        }

        // Advance escalation level (sla_breach already updated it above via break path)
        // step.action here is slack_ping | slack_urgent | email_admins (sla_breach exits via break)
        await db.update(organizations)
          .set({ escalationLevel: step.level })
          .where(eq(organizations.id, org.id));
        break; // only fire one new level per run — next cron fires the next level
      }

      // P-CNV1 applicant touch: 90min status email (kept separate from admin ladder)
      const ageMin = ageHrs * 60;
      const sent90 = (org.approvalReminderSentAt as any)?.t90;
      if (ageMin >= 85 && ageMin < 95 && !sent90 && resendKey) {
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({
            from: `MyDashRx <noreply@${senderDomain}>`,
            to: admin.email,
            reply_to: 'onboarding@mydashrx.com',
            subject: '[MyDashRx] Your application is being reviewed',
            track_clicks: false,
            headers: { 'Feedback-ID': 'approval-reminder:mydashrx:resend:transactional' },
            html: `<span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Your MyDashRx application is actively being reviewed.</span><div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px"><h2 style="color:#0F4C81;margin:0 0 8px">We're reviewing your application</h2><p style="color:#374151;font-size:15px">Hi ${admin.name}, your application for <strong>${org.name}</strong> is actively being reviewed. Most applications are approved within 2–4 business hours.</p><p style="color:#374151;font-size:15px">While you wait, you can <a href="${dashUrl}/pending-approval">prepare your onboarding checklist</a>.</p></div>`,
          }),
        }).catch((e: unknown) => { console.error('[CNV1] 90min email failed:', e); });
        await db.update(organizations)
          .set({ approvalReminderSentAt: { ...(org.approvalReminderSentAt as object ?? {}), t90: now.toISOString() } })
          .where(eq(organizations.id, org.id));
        sent++;
      }
    }

    return { sent, checked: pending.length };
  });

  // GET /admin/approvals/stream — P-ADM39: SSE live approval queue
  // EventSource doesn't support Authorization header — accept ?token= query param
  app.get('/approvals/stream', async (req, reply) => {
    const { token } = req.query as { token?: string };
    // Inject token from query param into Authorization header for jwtVerify
    if (token && !req.headers.authorization) {
      (req.headers as any).authorization = `Bearer ${token}`;
    }
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    const payload = req.user as { role: string };
    if (payload.role !== 'super_admin') return reply.code(403).send({ error: 'Forbidden' });

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.flushHeaders?.();

    approvalSseClients.add(reply);

    // Heartbeat every 25s — keeps connection alive through proxies
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(':\n\n');
    }, 25000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      approvalSseClients.delete(reply);
    });

    await new Promise<void>(resolve => req.raw.on('close', resolve));
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

  // P-ONB9: Onboarding nudge cron — POST /admin/jobs/onboarding-nudges
  // Triggered by external cron. Sends depot nudge at 4h, driver nudge at 68h, setup-call offer at 164h post-approval.
  app.post('/jobs/onboarding-nudges', { preHandler: auth }, async (_req, reply) => {
    const resendKey = process.env.RESEND_API_KEY;
    const senderDomain = process.env.SENDER_DOMAIN ?? 'mydashrx.com';
    const dashUrl = process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';

    const now = Date.now();
    const WINDOWS = [
      { label: 'depot',   minMs: 4 * 3600000,   maxMs: 6 * 3600000 },   // 4–6h after approval
      { label: 'driver',  minMs: 68 * 3600000,   maxMs: 72 * 3600000 },  // Day 3
      { label: 'call',    minMs: 164 * 3600000,  maxMs: 168 * 3600000 }, // Day 7
    ];

    const sent: string[] = [];

    for (const window of WINDOWS) {
      const minApprovedAt = new Date(now - window.maxMs);
      const maxApprovedAt = new Date(now - window.minMs);

      // Orgs approved within this nudge window
      const targetOrgs = await db
        .select({ id: organizations.id, name: organizations.name, approvedAt: organizations.approvedAt })
        .from(organizations)
        .where(and(
          isNull(organizations.deletedAt),
          eq(organizations.pendingApproval, false),
          isNotNull(organizations.approvedAt),
          gte(organizations.approvedAt, minApprovedAt),
          lt(organizations.approvedAt, maxApprovedAt),
        ));

      for (const org of targetOrgs) {
        const [admin] = await db.select({ email: users.email, name: users.name })
          .from(users)
          .where(and(eq(users.orgId, org.id), eq(users.role, 'pharmacy_admin'), isNull(users.deletedAt)))
          .limit(1);
        if (!admin || !resendKey) continue;

        const [depotRow] = await db.select({ id: depots.id }).from(depots)
          .where(and(eq(depots.orgId, org.id), isNull(depots.deletedAt))).limit(1);

        const [driverRow] = await db.select({ id: drivers.id }).from(drivers)
          .where(and(eq(drivers.orgId, org.id), isNull(drivers.deletedAt))).limit(1);

        let subject = '', html = '';

        if (window.label === 'depot' && !depotRow) {
          subject = `Quick step to finish your MyDashRx setup — add your first depot`;
          html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
            <h2 style="color:#0F4C81;margin:0 0 8px">One step to go, ${admin.name.split(' ')[0]}!</h2>
            <p style="color:#374151;font-size:15px;margin:0 0 16px">Your account is approved. Add a depot so your drivers know where to start routes.</p>
            <a href="${dashUrl}/dashboard/settings" style="display:inline-block;background:#0F4C81;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">Add Your First Depot →</a>
          </div>`;
        } else if (window.label === 'driver' && !driverRow) {
          subject = `Your depot is set — now add a driver to start delivering`;
          html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
            <h2 style="color:#0F4C81;margin:0 0 8px">Add your first driver</h2>
            <p style="color:#374151;font-size:15px;margin:0 0 16px">Drivers receive login credentials by email and can start accepting routes immediately.</p>
            <a href="${dashUrl}/dashboard/settings" style="display:inline-block;background:#0F4C81;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">Add a Driver →</a>
          </div>`;
        } else if (window.label === 'call' && (!depotRow || !driverRow)) {
          subject = `Let us help you get set up — book a free 15-min call`;
          html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
            <h2 style="color:#0F4C81;margin:0 0 8px">Need a hand?</h2>
            <p style="color:#374151;font-size:15px;margin:0 0 16px">Our team can walk you through setup in 15 minutes. No obligation.</p>
            <a href="mailto:support@mydashrx.com?subject=Setup help for ${encodeURIComponent(org.name)}" style="display:inline-block;background:#0F4C81;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">Book a Setup Call →</a>
          </div>`;
        } else {
          continue; // already completed this step, skip
        }

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({ from: `MyDashRx <noreply@${senderDomain}>`, to: admin.email, reply_to: 'onboarding@mydashrx.com', subject, html, track_clicks: false, track_opens: false, headers: { 'Feedback-ID': 'onboarding-nudge:mydashrx:resend:transactional' } }),
        }).catch((e: unknown) => { console.error('[ONB9] email failed:', e); });

        sent.push(`${org.id}:${window.label}`);
      }
    }

    return { sent };
  });

  // ── Test Seed Endpoint ─────────────────────────────────────────────────────
  // Creates/resets 4 test accounts (one per role) with known credentials,
  // auto-approves the test org, seeds depot + driver, revokes stale sessions.
  // super_admin only. Never runs in production unless explicitly called.
  app.post('/test-seed', { preHandler: auth }, async (_req, reply) => {
    const bcrypt = await import('bcryptjs');
    const TEST_PASSWORD = 'TestSeed123!';
    const TEST_ORG_NAME = 'MyDashRx Test Pharmacy';

    // ── 1. Ensure test org exists and is approved ────────────────────────────
    let testOrg = await db.select().from(organizations)
      .where(eq(organizations.name, TEST_ORG_NAME)).limit(1).then(r => r[0]);

    if (!testOrg) {
      [testOrg] = await db.insert(organizations).values({
        name: TEST_ORG_NAME,
        pendingApproval: false,
        approvedAt: new Date(),
      }).returning();
    } else {
      await db.update(organizations)
        .set({ pendingApproval: false, approvedAt: new Date(), rejectedAt: null })
        .where(eq(organizations.id, testOrg!.id));
    }
    const orgId = testOrg!.id;

    // ── 2. Ensure test depot exists ──────────────────────────────────────────
    let testDepot = await db.select().from(depots)
      .where(eq(depots.orgId, orgId)).limit(1).then(r => r[0]);

    if (!testDepot) {
      [testDepot] = await db.insert(depots).values({
        orgId,
        name: 'Test Pharmacy Hub',
        address: '100 Test Ave, Detroit, MI 48226',
        lat: 42.3314,
        lng: -83.0458,
      }).returning();
    }
    const depotId = testDepot!.id;

    // ── 3. Upsert test users ─────────────────────────────────────────────────
    const TEST_ACCOUNTS = [
      { email: 'test-sa@mydashrx-test.com',         role: 'super_admin'    as const, name: 'Test Super Admin',    depotIds: [] as string[] },
      { email: 'test-pharmacy@mydashrx-test.com',   role: 'pharmacy_admin' as const, name: 'Test Pharmacy Admin', depotIds: [depotId] },
      { email: 'test-dispatcher@mydashrx-test.com', role: 'dispatcher'     as const, name: 'Test Dispatcher',     depotIds: [depotId] },
      { email: 'test-driver@mydashrx-test.com',     role: 'driver'         as const, name: 'Test Driver',         depotIds: [] as string[] },
    ];

    const hash = await bcrypt.default.hash(TEST_PASSWORD, 10);
    const upsertedIds: Record<string, string> = {};

    for (const acct of TEST_ACCOUNTS) {
      const existing = await db.select({ id: users.id }).from(users)
        .where(eq(users.email, acct.email)).limit(1).then(r => r[0]);

      if (existing) {
        await db.update(users).set({
          passwordHash: hash,
          depotIds: acct.depotIds,
          orgId,
          mustChangePassword: false,
          failedLoginAttempts: 0,
          lockedUntil: null,
        }).where(eq(users.id, existing.id));
        upsertedIds[acct.role] = existing.id;
        // Revoke all existing sessions — fresh slate each seed call
        await db.update(refreshTokens).set({ status: 'revoked' })
          .where(and(eq(refreshTokens.userId, existing.id), eq(refreshTokens.status, 'active')));
      } else {
        const [created] = await db.insert(users).values({
          orgId,
          email: acct.email,
          passwordHash: hash,
          name: acct.name,
          role: acct.role,
          depotIds: acct.depotIds,
        }).returning({ id: users.id });
        upsertedIds[acct.role] = created!.id;
      }
    }

    // ── 4. Ensure driver record exists for test-driver ───────────────────────
    let testDriver = await db.select({ id: drivers.id }).from(drivers)
      .where(and(eq(drivers.orgId, orgId), eq(drivers.email, 'test-driver@mydashrx-test.com'), isNull(drivers.deletedAt)))
      .limit(1).then(r => r[0]);

    if (!testDriver) {
      [testDriver] = await db.insert(drivers).values({
        orgId,
        email: 'test-driver@mydashrx-test.com',
        name: 'Test Driver',
        passwordHash: hash,
        phone: '+13135550198',
        vehicleType: 'car',
        status: 'available',
      }).returning({ id: drivers.id });
    }

    return reply.send({
      message: 'Test accounts seeded. All sessions cleared.',
      password: TEST_PASSWORD,
      orgId,
      depotId,
      driverId: testDriver!.id,
      accounts: {
        super_admin:    'test-sa@mydashrx-test.com',
        pharmacy_admin: 'test-pharmacy@mydashrx-test.com',
        dispatcher:     'test-dispatcher@mydashrx-test.com',
        driver:         'test-driver@mydashrx-test.com',
      },
    });
  });

  // GET /admin/rbac-audit — P-RBAC27: HIPAA periodic access review snapshot
  // Returns all active users + roles + derived permissions + lastLoginAt for super_admin review.
  // Writes rbac_audit_export event to adminAuditLogs (HIPAA §164.308(a)(4)(ii)(C)).
  app.get('/rbac-audit', { preHandler: auth }, async (req, reply) => {
    const actor = req.user as { sub: string; email: string };
    const allUsers = await db
      .select({
        id: users.id, email: users.email, name: users.name,
        role: users.role, orgId: users.orgId,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(isNull(users.deletedAt))
      .orderBy(users.orgId, users.role);

    const result = allUsers.map(u => ({
      ...u,
      permissions: ROLE_PERMISSIONS[u.role as keyof typeof ROLE_PERMISSIONS] ?? [],
    }));

    // Fire-and-forget audit log
    db.insert(adminAuditLogs).values({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'rbac_audit_export',
      targetId: 'system',
      targetName: 'all_users',
      metadata: { userCount: result.length },
    }).catch(console.error);

    return reply.send({ generatedAt: new Date().toISOString(), userCount: result.length, users: result });
  });

  // GET /admin/session-audit — P-SES24: paginated session history with CSV export
  // HIPAA §164.308(a)(1)(ii)(D) — information system activity review
  app.get('/session-audit', { preHandler: auth }, async (req, reply) => {
    const actor = req.user as { sub: string; email: string };
    const { page = '1', limit = '100', format } = req.query as { page?: string; limit?: string; format?: string };
    const pageNum = Math.max(1, parseInt(page, 10));
    const pageSize = Math.min(500, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * pageSize;

    const rows = await db
      .select({
        sessionId: refreshTokens.jti,
        userId: refreshTokens.userId,
        userEmail: users.email,
        userName: users.name,
        userRole: users.role,
        orgId: users.orgId,
        status: refreshTokens.status,
        ip: refreshTokens.ip,
        userAgent: refreshTokens.userAgent,
        deviceName: refreshTokens.deviceName,
        createdAt: refreshTokens.createdAt,
        lastUsedAt: refreshTokens.lastUsedAt,
        expiresAt: refreshTokens.expiresAt,
      })
      .from(refreshTokens)
      .innerJoin(users, eq(refreshTokens.userId, users.id))
      .orderBy(desc(refreshTokens.createdAt))
      .limit(pageSize)
      .offset(offset);

    // Audit log the export event (HIPAA §164.308(a)(1)(ii)(D))
    db.insert(adminAuditLogs).values({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'session_audit_export',
      targetId: 'system',
      targetName: 'all_sessions',
      metadata: { format: format ?? 'json', page: pageNum, limit: pageSize, rowsReturned: rows.length },
    }).catch(console.error);

    if (format === 'csv') {
      const header = 'sessionId,userId,userEmail,userName,userRole,orgId,status,ip,userAgent,deviceName,createdAt,lastUsedAt,expiresAt';
      const csvRows = rows.map(r =>
        [r.sessionId, r.userId, r.userEmail, r.userName, r.userRole, r.orgId, r.status,
          r.ip ?? '', (r.userAgent ?? '').replace(/,/g, ';'), r.deviceName ?? '',
          r.createdAt.toISOString(), r.lastUsedAt?.toISOString() ?? '', r.expiresAt.toISOString(),
        ].join(',')
      );
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="session-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
      return reply.send([header, ...csvRows].join('\n'));
    }

    return reply.send({ generatedAt: new Date().toISOString(), page: pageNum, limit: pageSize, count: rows.length, sessions: rows });
  });

  // GET /admin/audit-chain-verify — P-SEC33: verify hash chain integrity of audit logs
  // Super admin only. Returns broken chain count — 0 means tamper-free. HIPAA §164.312(b).
  app.get('/audit-chain-verify', { preHandler: auth }, async (req, reply) => {
    const actor = req.user as { sub: string; email: string; role: string };
    // requireRole('super_admin') preHandler already validated role — belt-and-suspenders check
    if (actor.role !== 'super_admin') return reply.code(403).send({ error: 'Forbidden' });

    const computeHash = (id: string, orgId: string, action: string, createdAt: Date | string, prevHash: string) =>
      createHash('sha256').update(String(id) + String(orgId) + String(action) + String(createdAt) + String(prevHash)).digest('hex');

    // Verify audit_logs chain
    const alRows = await db.select().from(auditLogs).orderBy(asc(auditLogs.createdAt));
    let alBroken = 0;
    for (let i = 0; i < alRows.length; i++) {
      const r = alRows[i];
      if (!r.rowHash) continue; // pre-P-SEC33 rows have no hash — skip
      const expectedPrev = i === 0 ? 'genesis' : (alRows[i - 1].rowHash ?? 'genesis');
      const expected = computeHash(r.id, r.orgId, r.action ?? '', r.createdAt, r.prevHash ?? expectedPrev);
      if (expected !== r.rowHash) alBroken++;
    }

    // Verify admin_audit_logs chain
    const aalRows = await db.select().from(adminAuditLogs).orderBy(asc(adminAuditLogs.createdAt));
    let aalBroken = 0;
    for (let i = 0; i < aalRows.length; i++) {
      const r = aalRows[i];
      if (!r.rowHash) continue;
      const expectedPrev = i === 0 ? 'genesis' : (aalRows[i - 1].rowHash ?? 'genesis');
      const expected = computeHash(r.id, r.actorId, r.action ?? '', r.createdAt, r.prevHash ?? expectedPrev);
      if (expected !== r.rowHash) aalBroken++;
    }

    await db.insert(adminAuditLogs).values({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'audit_chain_verify',
      targetId: actor.sub,
      targetName: 'audit_logs + admin_audit_logs',
      metadata: { auditLogsBroken: alBroken, adminAuditLogsBroken: aalBroken, totalRows: alRows.length + aalRows.length },
    } as any);

    return reply.send({
      generatedAt: new Date().toISOString(),
      auditLogs: { total: alRows.length, broken: alBroken, intact: alBroken === 0 },
      adminAuditLogs: { total: aalRows.length, broken: aalBroken, intact: aalBroken === 0 },
      overallIntact: alBroken === 0 && aalBroken === 0,
    });
  });

  // P-RBAC31: Super admin impersonation — POST /admin/impersonate/:orgId
  // Returns a scoped impersonation token the frontend stores and sends as X-Impersonate-Org.
  // Logs impersonation_start audit event. Impersonation is request-scoped via header (no long-lived token).
  app.post('/impersonate/:orgId', { preHandler: auth }, async (req, reply) => {
    const actor = req.user as { sub: string; email: string; role: string };
    const { orgId } = req.params as { orgId: string };

    const [org] = await db.select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
      .limit(1);

    if (!org) return reply.code(404).send({ error: 'Organization not found' });

    await logAuditAction(actor.sub, actor.email, 'impersonation_start', orgId, org.name, {
      impersonatorId: actor.sub,
      impersonatorEmail: actor.email,
      targetOrgId: orgId,
      targetOrgName: org.name,
    });

    return reply.code(200).send({
      orgId: org.id,
      orgName: org.name,
      message: 'Impersonation started. Send X-Impersonate-Org header on subsequent requests.',
      instructions: 'Add header: X-Impersonate-Org: ' + org.id,
    });
  });

  // P-RBAC31: End impersonation — DELETE /admin/impersonate
  // Logs impersonation_end event. Frontend clears the stored orgId.
  app.delete('/impersonate', { preHandler: auth }, async (req, reply) => {
    const actor = req.user as { sub: string; email: string };
    const impersonateHeader = req.headers['x-impersonate-org'];
    const impersonatedOrgId = Array.isArray(impersonateHeader) ? impersonateHeader[0] : impersonateHeader;

    await logAuditAction(actor.sub, actor.email, 'impersonation_end',
      impersonatedOrgId ?? 'unknown', impersonatedOrgId ?? 'unknown', {
        impersonatorId: actor.sub,
        endedAt: new Date().toISOString(),
      });

    return reply.code(200).send({ message: 'Impersonation ended.' });
  });

  // P-RBAC31: GET /admin/impersonate — list active impersonation sessions from audit log
  app.get('/impersonate/active', { preHandler: auth }, async (_req, reply) => {
    const rows = await db.select({
      id: adminAuditLogs.id,
      actorId: adminAuditLogs.actorId,
      actorEmail: adminAuditLogs.actorEmail,
      targetId: adminAuditLogs.targetId,
      targetName: adminAuditLogs.targetName,
      createdAt: adminAuditLogs.createdAt,
      metadata: adminAuditLogs.metadata,
    })
      .from(adminAuditLogs)
      .where(eq(adminAuditLogs.action, 'impersonation_start'))
      .orderBy(desc(adminAuditLogs.createdAt))
      .limit(50);

    return reply.send({ sessions: rows });
  });

  // ─── P-RBAC32: Role template admin CRUD ──────────────────────────────────────

  // GET /admin/role-templates — list all templates (platform + org-specific)
  app.get('/role-templates', { preHandler: requireRole('super_admin') }, async (req, reply) => {
    const { orgId } = req.query as { orgId?: string };
    const rows = await listTemplates(orgId);
    return reply.send({ templates: rows });
  });

  // PATCH /admin/role-templates — upsert a template (platform default or org-specific override)
  // Body: { orgId?: string | null, role: string, permissions: string[] }
  app.patch('/role-templates', { preHandler: requireRole('super_admin') }, async (req, reply) => {
    const body = req.body as { orgId?: string | null; role?: string; permissions?: string[] };
    if (!body.role || !Array.isArray(body.permissions)) {
      return reply.code(400).send({ error: 'role and permissions[] required' });
    }
    const validKeys = new Set(Object.keys(ROLE_PERMISSIONS));
    const unknown = body.permissions.filter(p => !validKeys.has(p as keyof typeof ROLE_PERMISSIONS));
    if (unknown.length > 0) {
      console.warn(`[RBAC32] Unknown permissions in template patch: ${unknown.join(', ')}`);
    }
    const orgId = body.orgId ?? null;

    // P-RBAC16: capture before-state for diff audit (HIPAA §164.312(b))
    const [existing] = await db.select({ permissions: roleTemplates.permissions })
      .from(roleTemplates)
      .where(orgId === null
        ? sql`org_id IS NULL AND role = ${body.role}`
        : and(eq(roleTemplates.orgId, orgId), eq(roleTemplates.role, body.role))
      ).limit(1);
    const beforePermissions: string[] = (existing?.permissions as string[]) ?? [];
    const afterPermissions = body.permissions;
    const added = afterPermissions.filter(p => !beforePermissions.includes(p));
    const removed = beforePermissions.filter(p => !afterPermissions.includes(p));

    await upsertTemplate(orgId, body.role, body.permissions);

    // P-RBAC16: audit with before/after diff
    const actor = req.user as { sub: string; email: string };
    await logAuditAction(actor.sub, actor.email, 'role_template_updated', orgId ?? 'platform', body.role, {
      orgId, role: body.role,
      before: beforePermissions,
      after: afterPermissions,
      diff: { added, removed },
      changedBy: actor.sub,
    });
    return reply.send({ ok: true, orgId, role: body.role, permissions: body.permissions, diff: { added, removed } });
  });

  // GET /admin/rbac-audit/permissions — P-RBAC16: permission change history with before/after diff
  // HIPAA §164.312(b): audit reconstruction for permission changes
  app.get('/rbac-audit/permissions', { preHandler: requireRole('super_admin') }, async (req, reply) => {
    const { orgId, role, format, cursor, limit: limitStr } = req.query as {
      orgId?: string; role?: string; format?: string; cursor?: string; limit?: string;
    };

    const pageLimit = Math.min(parseInt(limitStr ?? '100', 10), 500);
    const conditions: any[] = [eq(adminAuditLogs.action, 'role_template_updated')];
    if (cursor) {
      try {
        const { created_at, id } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { created_at: string; id: string };
        conditions.push(sql`(${adminAuditLogs.createdAt}, ${adminAuditLogs.id}) < (${new Date(created_at)}::timestamptz, ${id}::uuid)`);
      } catch { /* invalid cursor — first page */ }
    }

    let rows = await db.select().from(adminAuditLogs)
      .where(and(...conditions))
      .orderBy(desc(adminAuditLogs.createdAt))
      .limit(pageLimit + 1);

    // Filter by orgId/role on metadata (post-query filter — metadata is jsonb)
    rows = rows.filter(r => {
      const meta = r.metadata as Record<string, unknown> | null;
      if (orgId && meta?.orgId !== orgId) return false;
      if (role && r.targetName !== role) return false;
      return true;
    });

    const hasMore = rows.length > pageLimit;
    const events = rows.slice(0, pageLimit).map(r => {
      const meta = r.metadata as Record<string, unknown> | null;
      return {
        id: r.id,
        timestamp: r.createdAt,
        actor: r.actorEmail,
        role: r.targetName,
        orgId: meta?.orgId ?? null,
        before: meta?.before ?? [],
        after: meta?.after ?? [],
        diff: meta?.diff ?? { added: [], removed: [] },
      };
    });

    if (format === 'csv') {
      const actor = req.user as { sub: string; email: string };
      await logAuditAction(actor.sub, actor.email, 'rbac_audit_exported', actor.sub, actor.email, { rowCount: events.length });
      const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const header = 'timestamp,actor,role,org_id,permissions_added,permissions_removed\n';
      const body = events.map(e =>
        [e.timestamp, e.actor, e.role, e.orgId ?? 'platform',
          (e.diff as any)?.added?.join('|') ?? '',
          (e.diff as any)?.removed?.join('|') ?? '',
        ].map(escape).join(',')
      ).join('\n');
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="rbac-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
      return reply.send(header + body);
    }

    const last = events[events.length - 1];
    const nextCursor = hasMore && last
      ? Buffer.from(JSON.stringify({ created_at: last.timestamp?.toISOString?.() ?? last.timestamp, id: last.id })).toString('base64url')
      : null;
    return { events, nextCursor, hasMore };
  });

  // DELETE /admin/role-templates/:id — delete an org-specific template (restores platform default)
  app.delete('/role-templates/:id', { preHandler: requireRole('super_admin') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await db.select({ orgId: roleTemplates.orgId, role: roleTemplates.role, isDefault: roleTemplates.isDefault })
      .from(roleTemplates).where(eq(roleTemplates.id, id)).limit(1);
    if (!row) return reply.code(404).send({ error: 'Template not found' });
    if (row.isDefault) return reply.code(400).send({ error: 'Cannot delete platform default templates' });
    await db.delete(roleTemplates).where(eq(roleTemplates.id, id));
    if (row.orgId) invalidateOrg(row.orgId);
    else invalidateOrgRole(null, row.role);
    return reply.code(204).send();
  });

  // P-ML21: GET /admin/magic-link/funnel — delivery health metrics (super_admin only)
  // HIPAA §164.308(a)(6)(ii) — magic link analytics without exposing PHI
  app.get('/magic-link/funnel', { preHandler: auth }, async (_req, reply) => {
    // Use raw SQL for PERCENTILE_CONT (not available in Drizzle DSL)
    const [funnelRow] = await db.execute<{
      total_sent: string;
      total_clicked: string;
      total_confirmed: string;
      p50_send_click_ms: number | null;
      p95_send_click_ms: number | null;
      p50_send_confirm_ms: number | null;
      p95_send_confirm_ms: number | null;
    }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE sent_at IS NOT NULL) AS total_sent,
        COUNT(*) FILTER (WHERE first_clicked_at IS NOT NULL) AS total_clicked,
        COUNT(*) FILTER (WHERE confirmed_at IS NOT NULL) AS total_confirmed,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_clicked_at - sent_at)) * 1000)
          FILTER (WHERE sent_at IS NOT NULL AND first_clicked_at IS NOT NULL) AS p50_send_click_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_clicked_at - sent_at)) * 1000)
          FILTER (WHERE sent_at IS NOT NULL AND first_clicked_at IS NOT NULL) AS p95_send_click_ms,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (confirmed_at - sent_at)) * 1000)
          FILTER (WHERE sent_at IS NOT NULL AND confirmed_at IS NOT NULL) AS p50_send_confirm_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (confirmed_at - sent_at)) * 1000)
          FILTER (WHERE sent_at IS NOT NULL AND confirmed_at IS NOT NULL) AS p95_send_confirm_ms
      FROM magic_link_tokens
      WHERE created_at > NOW() - INTERVAL '30 days'
    `);

    // Per-provider breakdown — parse email domain
    const providerRows = await db.execute<{ provider: string; sent: string; clicked: string; confirmed: string }>(sql`
      SELECT
        CASE
          WHEN email ILIKE '%@gmail.com' OR email ILIKE '%@googlemail.com' THEN 'gmail'
          WHEN email ILIKE '%@outlook.com' OR email ILIKE '%@hotmail.com' OR email ILIKE '%@live.com' OR email ILIKE '%@msn.com' THEN 'outlook'
          WHEN email ILIKE '%@yahoo.com' OR email ILIKE '%@ymail.com' THEN 'yahoo'
          ELSE 'corporate'
        END AS provider,
        COUNT(*) FILTER (WHERE sent_at IS NOT NULL) AS sent,
        COUNT(*) FILTER (WHERE first_clicked_at IS NOT NULL) AS clicked,
        COUNT(*) FILTER (WHERE confirmed_at IS NOT NULL) AS confirmed
      FROM magic_link_tokens
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY 1
      ORDER BY sent DESC
    `);

    const sent = Number(funnelRow?.total_sent ?? 0);
    const clicked = Number(funnelRow?.total_clicked ?? 0);
    const confirmed = Number(funnelRow?.total_confirmed ?? 0);

    return reply.send({
      window: '30d',
      funnel: {
        sent,
        clicked,
        confirmed,
        sentToClickedRate: sent > 0 ? Math.round((clicked / sent) * 1000) / 10 : null,
        clickedToConfirmedRate: clicked > 0 ? Math.round((confirmed / clicked) * 1000) / 10 : null,
        sentToConfirmedRate: sent > 0 ? Math.round((confirmed / sent) * 1000) / 10 : null,
      },
      latency: {
        p50SendClickMs: funnelRow?.p50_send_click_ms ? Math.round(Number(funnelRow.p50_send_click_ms)) : null,
        p95SendClickMs: funnelRow?.p95_send_click_ms ? Math.round(Number(funnelRow.p95_send_click_ms)) : null,
        p50SendConfirmMs: funnelRow?.p50_send_confirm_ms ? Math.round(Number(funnelRow.p50_send_confirm_ms)) : null,
        p95SendConfirmMs: funnelRow?.p95_send_confirm_ms ? Math.round(Number(funnelRow.p95_send_confirm_ms)) : null,
      },
      byProvider: (providerRows as unknown as { provider: string; sent: string; clicked: string; confirmed: string }[]).map(r => ({
        provider: r.provider,
        sent: Number(r.sent),
        clicked: Number(r.clicked),
        confirmed: Number(r.confirmed),
        confirmRate: Number(r.sent) > 0 ? Math.round((Number(r.confirmed) / Number(r.sent)) * 1000) / 10 : null,
      })),
    });
  });

  // P-ML23: GET /admin/magic-link/audit?email= — lifecycle audit view for a specific email
  // Returns last 10 tokens with full timeline. Logs magic_link_audit_viewed (HIPAA §164.312(b))
  app.get('/magic-link/audit', { preHandler: auth }, async (req, reply) => {
    const { email } = req.query as { email?: string };
    if (!email) return reply.code(400).send({ error: 'email query param required' });

    const actor = req.user as { sub: string; email: string };

    // HIPAA §164.312(b): log every audit view
    await logAuditAction(actor.sub, actor.email, 'magic_link_audit_viewed', email, email, { queriedEmail: email });

    // Fetch last 10 tokens for this email with scanner events from audit_logs
    const tokens = await db.execute<{
      id: string; email: string; created_at: string; sent_at: string | null;
      first_clicked_at: string | null; confirmed_at: string | null;
      used_at: string | null; expires_at: string;
    }>(sql`
      SELECT id, email, created_at, sent_at, first_clicked_at, confirmed_at, used_at, expires_at
      FROM magic_link_tokens
      WHERE email = ${email}
      ORDER BY created_at DESC
      LIMIT 10
    `);

    // Fetch scanner pre-fetch events for these token emails in last 30d
    const scannerEvents = await db.execute<{ created_at: string; metadata: unknown }>(sql`
      SELECT created_at, metadata
      FROM audit_logs
      WHERE action = 'magic_link_scanner_pre_fetch'
        AND user_email = ${email}
        AND created_at > NOW() - INTERVAL '30 days'
      ORDER BY created_at DESC
      LIMIT 20
    `);

    return reply.send({
      email,
      tokens: (tokens as unknown as { id: string; email: string; created_at: string; sent_at: string | null; first_clicked_at: string | null; confirmed_at: string | null; used_at: string | null; expires_at: string }[]).map(t => ({
        id: t.id,
        requestedAt: t.created_at,
        sentAt: t.sent_at,
        firstClickedAt: t.first_clicked_at,
        confirmedAt: t.confirmed_at,
        usedAt: t.used_at,
        expiresAt: t.expires_at,
        isExpired: new Date(t.expires_at) <= new Date(),
        isUsed: !!t.used_at,
      })),
      scannerEvents: (scannerEvents as unknown as { created_at: string; metadata: unknown }[]).map(e => ({
        detectedAt: e.created_at,
        metadata: e.metadata,
      })),
    });
  });

  // P-ML23: POST /admin/magic-link/resend-protected — issue new ?protected=1 token on demand
  app.post('/magic-link/resend-protected', { preHandler: auth }, async (req, reply) => {
    const { email } = req.body as { email?: string };
    if (!email) return reply.code(400).send({ error: 'email required' });

    const actor = req.user as { sub: string; email: string };
    await logAuditAction(actor.sub, actor.email, 'magic_link_resend_protected', email, email, { initiatedBy: actor.email });

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return reply.code(503).send({ error: 'Email service not configured' });

    const { randomBytes: rb, createHmac: ch } = await import('crypto');
    const MAGIC_LINK_SECRET = process.env.MAGIC_LINK_SECRET ?? process.env.JWT_SECRET ?? '';
    const token = rb(32).toString('hex');
    const tokenHash = ch('sha256', MAGIC_LINK_SECRET).update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    const dashUrl = process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
    const protectedUrl = `${dashUrl}/auth/verify?token=${token}&protected=1`;

    await db.insert(magicLinkTokens).values({ email, tokenHash, expiresAt });

    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: (await import('../lib/emailHelpers.js')).authSender(),
        to: email,
        subject: 'Your protected MyDashRx login link',
        headers: { 'Feedback-ID': 'magic-link-protected:mydashrx:resend:auth' },
        track_clicks: false,
        track_opens: false,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
            <h2 style="color:#0F4C81;margin:0 0 8px">Protected Sign-in Link</h2>
            <p style="color:#374151;margin:0 0 24px;font-size:15px">This link requires one manual click to complete sign-in, preventing email scanner interference.</p>
            <a href="${protectedUrl}" style="display:inline-block;background:#0F4C81;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:600;">Sign in securely →</a>
            <p style="color:#9ca3af;font-size:12px;margin-top:24px">Expires in 30 minutes. If you didn't request this, ignore this email.</p>
          </div>`,
      }),
    }).then(async (res) => {
      if (res.ok) {
        db.update(magicLinkTokens).set({ sentAt: new Date() })
          .where(eq(magicLinkTokens.tokenHash, tokenHash)).catch(() => {});
      }
    }).catch(() => {});

    return reply.send({ ok: true, email, expiresAt });
  });
};
