import type { FastifyPluginAsync } from 'fastify';
import crypto from 'crypto';
import { db } from '../db/connection.js';
import { organizations, users, drivers, adminAuditLogs, depots, refreshTokens, stops, stopNotes } from '../db/schema.js';
import { eq, isNull, and, sql, inArray } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';
import bcrypt from 'bcryptjs';
import { checkDriverLimit } from '../utils/usageLimits.js';
import { sendRoleChangeEmail } from '../lib/emailHelpers.js';

// P-RBAC11: Validate that all provided depotIds belong to the org — prevents cross-org depot injection
async function validateDepotIds(orgId: string, depotIds: string[]): Promise<boolean> {
  if (!depotIds.length) return true;
  const found = await db.select({ id: depots.id }).from(depots)
    .where(and(inArray(depots.id, depotIds), eq(depots.orgId, orgId), isNull(depots.deletedAt)));
  return found.length === depotIds.length;
}

async function logRoleChange(
  actorId: string, actorEmail: string,
  targetId: string, targetEmail: string,
  action: string, metadata: Record<string, unknown>
) {
  await db.insert(adminAuditLogs).values({
    actorId, actorEmail, action,
    targetId, targetName: targetEmail,
    metadata,
  }).catch((e: unknown) => { console.error('[AuditLog] role change insert failed:', e); });
}

export const organizationRoutes: FastifyPluginAsync = async (app) => {
  // GET /orgs — super_admin only
  app.get('/', { preHandler: requireRole('super_admin') }, async () =>
    db.select().from(organizations).where(isNull(organizations.deletedAt)),
  );

  // GET /orgs/:orgId
  app.get('/:orgId', {
    preHandler: requireRole('super_admin', 'pharmacy_admin', 'dispatcher'),
  }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const user = req.user as { orgId: string; role: string };
    if (user.role !== 'super_admin' && user.orgId !== orgId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return reply.code(404).send({ error: 'Not found' });
    return org;
  });

  // POST /orgs — super_admin only
  app.post('/', { preHandler: requireRole('super_admin') }, async (req, reply) => {
    const body = req.body as { name: string; timezone?: string };
    if (!body.name) return reply.code(400).send({ error: 'name required' });
    const [org] = await db
      .insert(organizations)
      .values({ name: body.name, timezone: body.timezone ?? 'America/New_York' })
      .returning();
    return reply.code(201).send(org);
  });

  // PATCH /orgs/:orgId/onboarding-progress — P-ONB10: track wizard step completion timestamps
  app.patch('/:orgId/onboarding-progress', { preHandler: requireRole('super_admin', 'pharmacy_admin') }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const user = req.user as { orgId: string; role: string };
    if (user.role !== 'super_admin' && user.orgId !== orgId) return reply.code(403).send({ error: 'Forbidden' });
    const { step } = req.body as { step: 'depot' | 'driver' | 'completed' };
    const VALID = ['depot', 'driver', 'completed'];
    if (!VALID.includes(step)) return reply.code(400).send({ error: `step must be one of: ${VALID.join(', ')}` });
    const now = new Date();
    const updates = step === 'depot' ? { onboardingDepotAt: now }
      : step === 'driver' ? { onboardingDriverAt: now }
      : { onboardingCompletedAt: now };
    await db.update(organizations).set(updates).where(eq(organizations.id, orgId));
    return reply.send({ ok: true, step, ts: now.toISOString() });
  });

  // PATCH /orgs/:orgId
  app.patch('/:orgId', { preHandler: requireRole('super_admin', 'pharmacy_admin') }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const user = req.user as { orgId: string; role: string };
    if (user.role !== 'super_admin' && user.orgId !== orgId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const body = req.body as Partial<{ name: string; timezone: string }>;
    const updates: Partial<{ name: string; timezone: string }> = {};
    if (body.name !== undefined) {
      const trimmed = body.name.trim();
      if (!trimmed) return reply.code(400).send({ error: 'Organization name cannot be empty' });
      updates.name = trimmed;
    }
    if (body.timezone !== undefined) updates.timezone = body.timezone;
    const [updated] = await db
      .update(organizations)
      .set(updates)
      .where(eq(organizations.id, orgId))
      .returning();
    if (!updated) return reply.code(404).send({ error: 'Not found' });
    return updated;
  });

  // GET /orgs/:orgId/users
  app.get('/:orgId/users', { preHandler: requireRole('super_admin', 'pharmacy_admin') }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const user = req.user as { orgId: string; role: string };
    if (user.role !== 'super_admin' && user.orgId !== orgId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const rows = await db
      .select({
        id: users.id,
        orgId: users.orgId,
        email: users.email,
        name: users.name,
        role: users.role,
        depotIds: users.depotIds,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(and(eq(users.orgId, orgId), isNull(users.deletedAt)));
    return rows;
  });

  // PATCH /orgs/:orgId/users/:userId
  app.patch('/:orgId/users/:userId', { preHandler: requireRole('super_admin', 'pharmacy_admin') }, async (req, reply) => {
    const { orgId, userId } = req.params as { orgId: string; userId: string };
    const caller = req.user as { sub: string; orgId: string; role: string };
    if (caller.role !== 'super_admin' && caller.orgId !== orgId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    // Prevent self-role-change via API (UI hides pencil but API must enforce too)
    if (caller.sub === userId) {
      return reply.code(403).send({ error: 'Cannot change your own role' });
    }
    const body = req.body as Partial<{ name: string; role: string; depotIds: string[] }>;
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;

    // Fetch current user state for role-change pre-checks and notifications
    const [currentUser] = body.role !== undefined
      ? await db.select({ role: users.role, name: users.name, email: users.email })
          .from(users).where(and(eq(users.id, userId), eq(users.orgId, orgId), isNull(users.deletedAt))).limit(1)
      : [undefined];

    if (body.role !== undefined) {
      const ASSIGNABLE_ROLES = ['pharmacy_admin', 'dispatcher', 'pharmacist', 'driver'];
      if (!ASSIGNABLE_ROLES.includes(body.role)) {
        return reply.code(400).send({ error: `Invalid role. Must be one of: ${ASSIGNABLE_ROLES.join(', ')}` });
      }
      // pharmacy_admin cannot assign pharmacy_admin role (only super_admin can promote to admin)
      if (caller.role === 'pharmacy_admin' && body.role === 'pharmacy_admin') {
        return reply.code(403).send({ error: 'Insufficient permissions to assign this role' });
      }
      // Enforce driver limit when promoting to driver role
      if (body.role === 'driver') {
        const driverLimitCheck = await checkDriverLimit(orgId);
        if (!driverLimitCheck.allowed) {
          return reply.code(402).send({
            error: 'Driver limit reached',
            message: `Your plan allows ${driverLimitCheck.limit} active drivers. You have ${driverLimitCheck.current}. Upgrade to add more drivers.`,
            current: driverLimitCheck.current,
            limit: driverLimitCheck.limit,
          });
        }
      }
      updates.role = body.role;
      // P-SES6: Invalidate all outstanding refresh tokens when role changes (AT now fails on next use)
      updates.tokenVersion = sql`${users.tokenVersion} + 1`;
    }
    if (body.depotIds !== undefined) {
      // P-RBAC11: Validate all depot IDs belong to this org
      if (!(await validateDepotIds(orgId, body.depotIds))) {
        return reply.code(400).send({ error: 'One or more depot IDs are invalid for this organization' });
      }
      updates.depotIds = body.depotIds;
      // P-RBAC6: depot change invalidates AT immediately — same pattern as role change
      updates.tokenVersion = sql`${users.tokenVersion} + 1`;
    }
    const [updated] = await db
      .update(users)
      .set(updates)
      .where(and(eq(users.id, userId), eq(users.orgId, orgId)))
      .returning({ id: users.id, orgId: users.orgId, email: users.email, name: users.name, role: users.role, depotIds: users.depotIds, createdAt: users.createdAt });
    if (!updated) return reply.code(404).send({ error: 'Not found' });

    // P-RBAC30: Immediately revoke all active refresh token families on role change.
    // tokenVersion increment blocks next AT refresh, but existing active RTs can still start
    // a new rotation chain. Revoking by userId closes that window instantly.
    if (body.role !== undefined) {
      db.update(refreshTokens)
        .set({ status: 'revoked' })
        .where(and(eq(refreshTokens.userId, userId), eq(refreshTokens.status, 'active')))
        .catch((e: unknown) => { console.error('[RBAC30] RT revocation failed:', e); });
    }

    // HIPAA §164.312(b) — audit role/depot changes
    if (body.role !== undefined || body.depotIds !== undefined) {
      const actor = req.user as { sub: string; email: string; name?: string };
      const action = body.role !== undefined ? 'role_change' : 'depot_assign';
      await logRoleChange(actor.sub, actor.email, updated.id, updated.email, action, {
        ...(body.role !== undefined ? { oldRole: currentUser?.role, newRole: body.role } : {}),
        ...(body.depotIds !== undefined ? { newDepotIds: body.depotIds } : {}),
      });

      // P-RBAC29: Notify target user of role change via email (fire-and-forget)
      if (body.role !== undefined && currentUser) {
        sendRoleChangeEmail(
          updated.email,
          updated.name,
          actor.email,
          currentUser.role,
          body.role,
        ).catch(() => {});
      }
    }

    return updated;
  });

  // DELETE /orgs/:orgId/users/:userId — soft delete
  app.delete('/:orgId/users/:userId', { preHandler: requireRole('super_admin', 'pharmacy_admin') }, async (req, reply) => {
    const { orgId, userId } = req.params as { orgId: string; userId: string };
    const requestor = req.user as { sub: string; orgId: string; role: string };
    if (requestor.role !== 'super_admin' && requestor.orgId !== orgId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    if (requestor.sub === userId) {
      return reply.code(400).send({ error: 'Cannot remove yourself' });
    }
    // P-SES6: Increment tokenVersion on soft-delete — immediately revokes all outstanding refresh tokens
    await db
      .update(users)
      .set({ deletedAt: new Date(), tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(and(eq(users.id, userId), eq(users.orgId, orgId)));
    return reply.code(204).send();
  });

  // POST /orgs/:orgId/users/invite
  app.post('/:orgId/users/invite', { preHandler: requireRole('super_admin', 'pharmacy_admin') }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const requestor = req.user as { orgId: string; role: string };
    if (requestor.role !== 'super_admin' && requestor.orgId !== orgId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const body = req.body as { name: string; email: string; role: string; depotIds?: string[] };
    if (!body.name || !body.email || !body.role) {
      return reply.code(400).send({ error: 'name, email, and role are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return reply.code(400).send({ error: 'Invalid email address' });
    }
    const ASSIGNABLE_ROLES = ['pharmacy_admin', 'dispatcher', 'pharmacist', 'driver'];
    if (!ASSIGNABLE_ROLES.includes(body.role)) {
      return reply.code(400).send({ error: `Invalid role. Must be one of: ${ASSIGNABLE_ROLES.join(', ')}` });
    }
    if (requestor.role === 'pharmacy_admin' && body.role === 'pharmacy_admin') {
      return reply.code(403).send({ error: 'Insufficient permissions to assign this role' });
    }

    // Check if user already exists in org (including soft-deleted — prevents unique constraint 500)
    const [existing] = await db
      .select({ id: users.id, deletedAt: users.deletedAt })
      .from(users)
      .where(and(eq(users.email, body.email), eq(users.orgId, orgId)))
      .limit(1);
    if (existing) {
      if (existing.deletedAt) return reply.code(409).send({ error: 'This email belongs to a deactivated account. Contact support to reactivate.' });
      return reply.code(409).send({ error: 'User with this email already exists in the organization' });
    }

    // Check driver limit BEFORE creating user row to prevent split-brain state
    if (body.role === 'driver') {
      const driverLimitCheck = await checkDriverLimit(orgId);
      if (!driverLimitCheck.allowed) {
        return reply.code(402).send({
          error: 'Driver limit reached',
          message: `Your plan allows ${driverLimitCheck.limit} active drivers. You have ${driverLimitCheck.current}. Upgrade to add more drivers.`,
          current: driverLimitCheck.current,
          limit: driverLimitCheck.limit,
        });
      }
    }

    // P-RBAC11: Validate depot IDs belong to this org before creating user
    if (body.depotIds?.length && !(await validateDepotIds(orgId, body.depotIds))) {
      return reply.code(400).send({ error: 'One or more depot IDs are invalid for this organization' });
    }

    const tempPassword = crypto.randomBytes(6).toString('base64url');
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const [newUser] = await db
      .insert(users)
      .values({
        orgId,
        email: body.email,
        name: body.name,
        role: body.role as 'pharmacy_admin' | 'dispatcher' | 'pharmacist' | 'driver',
        depotIds: body.depotIds ?? [],
        passwordHash,
        mustChangePassword: true,
      })
      .returning({ id: users.id, orgId: users.orgId, email: users.email, name: users.name, role: users.role, depotIds: users.depotIds, createdAt: users.createdAt });

    let driverId: string | undefined;
    if (body.role === 'driver') {
      const [driverRecord] = await db.insert(drivers).values({
        orgId,
        name: body.name,
        email: body.email,
        phone: '',
        passwordHash,
        vehicleType: 'car',
      }).returning({ id: drivers.id });
      driverId = driverRecord.id;
    }

    // P-INV2: Send credential email to new staff member
    const resendKey = process.env.RESEND_API_KEY;
    const senderDomain = process.env.SENDER_DOMAIN ?? 'cartana.life';
    const dashUrl = process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
    if (resendKey) {
      const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: `MyDashRx <noreply@${senderDomain}>`,
          to: body.email,
          subject: `[MyDashRx] You've been added to ${org?.name ?? 'your pharmacy'}`,
          track_clicks: false,
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
              <h2 style="color:#0F4C81;margin:0 0 8px">Welcome to MyDashRx</h2>
              <p style="color:#374151;margin:0 0 8px;font-size:15px">Hi ${body.name},</p>
              <p style="color:#374151;margin:0 0 24px;font-size:15px">Your account has been created on MyDashRx by your administrator.</p>
              <p style="color:#374151;margin:0 0 8px;font-size:15px"><strong>Your login details:</strong></p>
              <ul style="color:#374151;font-size:15px;margin:0 0 24px;padding-left:20px">
                <li>Email: ${body.email}</li>
                <li>Temporary password: <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px">${tempPassword}</code></li>
                <li>Role: ${body.role}</li>
              </ul>
              <a href="${dashUrl}/login" style="display:inline-block;background:#0F4C81;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:600;">Sign in to MyDashRx</a>
              <p style="color:#9ca3af;font-size:12px;margin-top:24px">You will be asked to set a new password on first login.</p>
            </div>`,
        }),
      }).catch((e: unknown) => { console.error('[Invite] credential email failed:', e); });
    }

    return reply.code(201).send({ user: newUser, tempPassword, ...(driverId ? { driverId } : {}) });
  });

  // POST /orgs/:orgId/baa-accept — P-ONB37: record BAA digital acceptance for HIPAA §164.308(b)(1)
  app.post('/:orgId/baa-accept', { preHandler: requireRole('pharmacy_admin', 'super_admin') }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const actor = req.user as { sub: string; email: string; orgId: string; role: string };

    // Pharmacy admin can only accept BAA for their own org
    if (actor.role === 'pharmacy_admin' && actor.orgId !== orgId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const [org] = await db.select({ id: organizations.id, name: organizations.name, baaAcceptedAt: organizations.baaAcceptedAt })
      .from(organizations).where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt))).limit(1);
    if (!org) return reply.code(404).send({ error: 'Organization not found' });

    // Idempotent — return success if already accepted
    if (org.baaAcceptedAt) {
      return { success: true, baaAcceptedAt: org.baaAcceptedAt, alreadyAccepted: true };
    }

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? null;
    const ua = (req.headers['user-agent'] as string) ?? null;
    const now = new Date();

    await db.update(organizations).set({
      baaAcceptedAt: now,
      baaAcceptedByUserId: actor.sub,
      baaIpAddress: ip,
      baaUserAgent: ua,
      hipaaBaaStatus: 'signed',
    }).where(eq(organizations.id, orgId));

    // Audit log — HIPAA §164.312(b) requires access activity logs
    await db.insert(adminAuditLogs).values({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'baa_accepted',
      targetId: orgId,
      targetName: org.name,
      metadata: { ip, userAgent: ua, acceptedAt: now.toISOString() },
    }).catch((e: unknown) => { console.error('[AuditLog] baa_accepted insert failed:', e); });

    return reply.code(201).send({ success: true, baaAcceptedAt: now });
  });

  // PATCH /orgs/:orgId/onboarding/progress — P-CNV22: persist onboarding step server-side
  // Prevents abandonment on browser refresh / tab close. Idempotent — only advances step, never regresses.
  app.patch('/:orgId/onboarding/progress', {
    preHandler: requireRole('pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const actor = req.user as { sub: string; orgId: string; role: string };
    if (actor.role !== 'super_admin' && actor.orgId !== orgId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const { step } = req.body as { step?: number };
    if (typeof step !== 'number' || step < 1 || step > 5) {
      return reply.code(400).send({ error: 'step must be an integer 1–5' });
    }
    const [org] = await db.select({ id: organizations.id, onboardingStep: organizations.onboardingStep, onboardingCompletedAt: organizations.onboardingCompletedAt })
      .from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return reply.code(404).send({ error: 'Not found' });

    const currentStep = org.onboardingStep ?? 1;
    // Only advance — never regress (protect against concurrent tab / back-button issues)
    if (step <= currentStep && step !== 5) {
      return reply.send({ onboardingStep: currentStep, onboardingCompletedAt: org.onboardingCompletedAt });
    }

    const now = new Date();
    const completedAt = step === 5 && !org.onboardingCompletedAt ? now : undefined;
    await db.update(organizations)
      .set({ onboardingStep: step, ...(completedAt ? { onboardingCompletedAt: completedAt } : {}) })
      .where(eq(organizations.id, orgId));

    return reply.send({ onboardingStep: step, onboardingCompletedAt: completedAt ?? org.onboardingCompletedAt });
  });

  // GET /orgs/:orgId/onboarding/progress — P-CNV22: restore onboarding step on page load
  app.get('/:orgId/onboarding/progress', {
    preHandler: requireRole('pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const actor = req.user as { orgId: string; role: string };
    if (actor.role !== 'super_admin' && actor.orgId !== orgId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const [org] = await db.select({ onboardingStep: organizations.onboardingStep, onboardingCompletedAt: organizations.onboardingCompletedAt })
      .from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return reply.code(404).send({ error: 'Not found' });
    return { onboardingStep: org.onboardingStep ?? 1, onboardingCompletedAt: org.onboardingCompletedAt };
  });

  // ── P-DISP1: Per-stop dispatcher notes ─────────────────────────────────────────
  // POST /orgs/:orgId/stops/:stopId/notes — create dispatcher note on a stop
  // Eliminates out-of-band Signal/SMS carrying patient PHI. HIPAA audit on every create.
  app.post('/:orgId/stops/:stopId/notes', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'pharmacist', 'super_admin'),
  }, async (req, reply) => {
    const { orgId, stopId } = req.params as { orgId: string; stopId: string };
    const actor = req.user as { sub: string; orgId: string; role: string; email: string; name?: string };
    if (actor.role !== 'super_admin' && actor.orgId !== orgId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const { body, visibleToDriver = true } = req.body as { body?: string; visibleToDriver?: boolean };
    if (!body?.trim()) return reply.code(400).send({ error: 'body is required' });

    // Verify stop belongs to org
    const [stop] = await db.select({ id: stops.id, recipientName: stops.recipientName })
      .from(stops).where(and(eq(stops.id, stopId), eq(stops.orgId, orgId), isNull(stops.deletedAt))).limit(1);
    if (!stop) return reply.code(404).send({ error: 'Stop not found' });

    // Fetch author name for display
    const [author] = await db.select({ name: users.name }).from(users).where(eq(users.id, actor.sub)).limit(1);
    const authorName = author?.name ?? actor.email ?? 'Unknown';

    const [note] = await db.insert(stopNotes).values({
      stopId, orgId, authorId: actor.sub, authorName, body: body.trim(),
      visibleToDriver: Boolean(visibleToDriver),
    }).returning();

    // HIPAA audit log — PHI access on stop note creation
    db.insert(adminAuditLogs).values({
      actorId: actor.sub, actorEmail: actor.email,
      action: 'stop_note_created',
      targetId: stopId, targetName: stop.recipientName ?? stopId,
      metadata: { noteId: note.id, orgId, visibleToDriver, bodyLength: body.trim().length },
    }).catch((e: unknown) => { console.error('[AuditLog] stop_note_created failed:', e); });

    return reply.code(201).send(note);
  });

  // GET /orgs/:orgId/stops/:stopId/notes — list notes on a stop
  // Dispatchers/admins see all notes. Drivers see only visibleToDriver=true notes.
  app.get('/:orgId/stops/:stopId/notes', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'pharmacist', 'driver', 'super_admin'),
  }, async (req, reply) => {
    const { orgId, stopId } = req.params as { orgId: string; stopId: string };
    const actor = req.user as { sub: string; orgId: string; role: string };
    if (actor.role !== 'super_admin' && actor.orgId !== orgId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    // Verify stop belongs to org
    const [stop] = await db.select({ id: stops.id }).from(stops)
      .where(and(eq(stops.id, stopId), eq(stops.orgId, orgId), isNull(stops.deletedAt))).limit(1);
    if (!stop) return reply.code(404).send({ error: 'Stop not found' });

    const rows = await db.select()
      .from(stopNotes)
      .where(and(
        eq(stopNotes.stopId, stopId),
        eq(stopNotes.orgId, orgId),
        isNull(stopNotes.deletedAt),
        // Drivers only see notes flagged visible
        ...(actor.role === 'driver' ? [eq(stopNotes.visibleToDriver, true)] : []),
      ));

    return rows;
  });

  // DELETE /orgs/:orgId/stops/:stopId/notes/:noteId — soft-delete a note (author or admin only)
  app.delete('/:orgId/stops/:stopId/notes/:noteId', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId, stopId, noteId } = req.params as { orgId: string; stopId: string; noteId: string };
    const actor = req.user as { sub: string; orgId: string; role: string };
    if (actor.role !== 'super_admin' && actor.orgId !== orgId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const [note] = await db.select({ id: stopNotes.id, authorId: stopNotes.authorId })
      .from(stopNotes).where(and(eq(stopNotes.id, noteId), eq(stopNotes.stopId, stopId), isNull(stopNotes.deletedAt))).limit(1);
    if (!note) return reply.code(404).send({ error: 'Note not found' });
    // Author or admin can delete
    if (actor.role !== 'super_admin' && actor.role !== 'pharmacy_admin' && note.authorId !== actor.sub) {
      return reply.code(403).send({ error: 'Can only delete your own notes' });
    }
    await db.update(stopNotes).set({ deletedAt: new Date() }).where(eq(stopNotes.id, noteId));
    return reply.code(204).send();
  });

  // GET /orgs/:orgId/baa/status — P-COMP11: BAA acceptance status for compliance tab
  app.get('/:orgId/baa/status', {
    preHandler: requireRole('pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const actor = req.user as { orgId: string; role: string };
    if (actor.role !== 'super_admin' && actor.orgId !== orgId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const [org] = await db.select({
      baaAcceptedAt: organizations.baaAcceptedAt,
      baaAcceptedByUserId: organizations.baaAcceptedByUserId,
      baaIpAddress: organizations.baaIpAddress,
      hipaaBaaStatus: organizations.hipaaBaaStatus,
    }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return reply.code(404).send({ error: 'Not found' });

    const accepted = !!org.baaAcceptedAt;
    // Fetch signer name if we have a userId
    let signerName: string | null = null;
    if (org.baaAcceptedByUserId) {
      const [u] = await db.select({ name: users.name, email: users.email })
        .from(users).where(eq(users.id, org.baaAcceptedByUserId)).limit(1);
      signerName = u?.name ?? u?.email ?? null;
    }
    return {
      accepted,
      baaAcceptedAt: org.baaAcceptedAt ?? null,
      signerName,
      ipAddress: org.baaIpAddress ?? null,
      hipaaBaaStatus: org.hipaaBaaStatus,
    };
  });
};
