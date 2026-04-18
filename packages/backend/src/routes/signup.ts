import type { FastifyPluginAsync } from 'fastify';
import { createHmac, timingSafeEqual, randomBytes } from 'crypto';
import { z } from 'zod';
import { db } from '../db/connection.js';
import { organizations, users, drivers, staffInvitations } from '../db/schema.js';
import { eq, and, isNull, gt, inArray } from 'drizzle-orm';
import { hashPassword, signTokens, findUserByEmail } from '../services/auth.js';

const pharmacySignupSchema = z.object({
  orgName: z.string().min(2).max(120),
  orgPhone: z.string().min(7).max(20).optional(),
  orgAddress: z.string().min(5).max(200).optional(),
  adminName: z.string().min(2).max(100),
  adminEmail: z.string().email(),
});

const driverSignupSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  phone: z.string().min(7).max(20),
  orgId: z.string().uuid().optional(),
});

const acceptInviteSchema = z.object({
  token: z.string().min(10),
  name: z.string().min(2).max(100),
});

async function sendApplicantConfirmation(orgName: string, adminEmail: string, adminName: string) {
  const resendKey = process.env.RESEND_API_KEY;
  const senderDomain = process.env.SENDER_DOMAIN ?? 'mydashrx.com';
  if (!resendKey) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
    body: JSON.stringify({
      from: `MyDashRx <noreply@${senderDomain}>`,
      to: adminEmail,
      subject: `We received your application — ${orgName}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
          <h2 style="color:#0F4C81;margin:0 0 8px">Application received!</h2>
          <p style="color:#374151;margin:0 0 16px;font-size:15px">Hi ${adminName},</p>
          <p style="color:#374151;margin:0 0 16px;font-size:15px">
            We've received your application for <strong>${orgName}</strong> and our team will review it within
            <strong>2–4 business hours</strong>.
          </p>
          <p style="color:#374151;margin:0 0 8px;font-size:14px;font-weight:600;">While you wait, get a head start:</p>
          <ul style="color:#374151;font-size:14px;padding-left:20px;margin:0 0 24px">
            <li style="margin-bottom:6px">Gather your pharmacy NPI number and state license</li>
            <li style="margin-bottom:6px">Prepare your staff list with names and email addresses</li>
            <li style="margin-bottom:6px">Download the MyDashRx driver app so drivers are ready on day one</li>
          </ul>
          <p style="color:#6b7280;font-size:13px">Questions? Reply to this email or contact <a href="mailto:support@mydashrx.com" style="color:#0F4C81;">support@mydashrx.com</a>.</p>
        </div>`,
    }),
  }).catch((e: unknown) => { console.error('[Resend] applicant confirmation failed:', e); });
}

async function notifySuperAdmins(orgName: string, adminEmail: string) {
  const resendKey = process.env.RESEND_API_KEY;
  const senderDomain = process.env.SENDER_DOMAIN ?? 'mydashrx.com';
  const dashUrl = process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
  if (!resendKey) return;

  const superAdmins = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.role, 'super_admin'), isNull(users.deletedAt)));

  if (superAdmins.length === 0) return;

  await Promise.allSettled(superAdmins.map(sa =>
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: `MyDashRx <noreply@${senderDomain}>`,
        to: sa.email,
        subject: `New pharmacy signup — ${orgName}`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
            <h2 style="color:#0F4C81;margin:0 0 8px">New Pharmacy Signup</h2>
            <p style="color:#374151;margin:0 0 16px"><strong>${orgName}</strong> has submitted a signup request.</p>
            <p style="color:#374151;margin:0 0 24px">Admin contact: ${adminEmail}</p>
            <a href="${dashUrl}/admin/approvals" style="display:inline-block;background:#0F4C81;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">Review in Admin Panel</a>
          </div>`,
      }),
    }).catch((e: unknown) => { console.error('[Resend] super-admin notify failed:', e); })
  ));
}

export const signupRoutes: FastifyPluginAsync = async (app) => {
  // ─── Pharmacy Owner Signup ────────────────────────────────────────────────
  app.post('/pharmacy', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const parsed = pharmacySignupSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    const { orgName, orgPhone, orgAddress, adminName, adminEmail } = parsed.data;

    const existing = await findUserByEmail(adminEmail);
    if (existing) return reply.code(409).send({ error: 'An account with this email already exists.' });

    const [org] = await db.insert(organizations).values({
      name: orgName,
      pendingApproval: true,
    }).returning();

    const passwordHash = await hashPassword(randomBytes(32).toString('hex'));
    await db.insert(users).values({
      orgId: org.id,
      email: adminEmail,
      passwordHash,
      name: adminName,
      role: 'pharmacy_admin',
      pendingApproval: true,
    });

    notifySuperAdmins(orgName, adminEmail).catch((e: unknown) => { console.error('[Resend] pharmacy signup notify failed:', e); });
    sendApplicantConfirmation(orgName, adminEmail, adminName).catch((e: unknown) => { console.error('[Resend] applicant confirmation failed:', e); });

    return reply.code(201).send({ message: 'Application submitted. You will hear from us within 2–4 business hours.' });
  });

  // ─── Driver Signup ────────────────────────────────────────────────────────
  app.post('/driver', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const parsed = driverSignupSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    const { name, email, phone, orgId } = parsed.data;

    const existing = await findUserByEmail(email);
    if (existing) return reply.code(409).send({ error: 'An account with this email already exists.' });

    // Use submitted orgId if provided, otherwise fall back to first active org
    const orgQuery = db.select().from(organizations)
      .where(and(isNull(organizations.deletedAt), eq(organizations.pendingApproval, false)));
    const [org] = orgId
      ? await db.select().from(organizations)
          .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt), eq(organizations.pendingApproval, false)))
          .limit(1)
      : await orgQuery.limit(1);

    if (!org) return reply.code(400).send({ error: 'No active organization available for driver signup.' });

    const passwordHash = await hashPassword(randomBytes(32).toString('hex'));
    const [user] = await db.insert(users).values({
      orgId: org.id, email, passwordHash, name, role: 'driver',
    }).returning();

    const [driverRecord] = await db.insert(drivers).values({
      orgId: org.id, name, email, phone, passwordHash, vehicleType: 'car',
    }).returning();

    const tokens = signTokens(app, {
      sub: user.id, email: user.email, role: user.role, orgId: user.orgId,
      depotIds: [], ...(driverRecord ? { driverId: driverRecord.id } : {}),
    } as any);

    return reply.code(201).send({
      ...tokens,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.orgId, depotIds: [], driverId: driverRecord.id },
    });
  });

  // ─── Staff Invitation — Create ────────────────────────────────────────────
  app.post('/invite', async (req, reply) => {
    try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    const me = req.user as { sub: string; role: string; orgId: string };
    if (!['super_admin', 'pharmacy_admin', 'dispatcher'].includes(me.role)) {
      return reply.code(403).send({ error: 'Insufficient permissions' });
    }

    const { email, role } = req.body as { email?: string; role?: string };
    if (!email || !z.string().email().safeParse(email).success) {
      return reply.code(400).send({ error: 'Valid email required' });
    }
    const validRoles = ['pharmacist', 'dispatcher', 'driver'];
    if (role && !validRoles.includes(role)) {
      return reply.code(400).send({ error: `Role must be one of: ${validRoles.join(', ')}` });
    }

    const token = randomBytes(32).toString('hex');
    const INVITE_SECRET = process.env.MAGIC_LINK_SECRET ?? process.env.JWT_SECRET ?? 'fallback';
    const tokenHash = createHmac('sha256', INVITE_SECRET).update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await db.insert(staffInvitations).values({
      orgId: me.orgId,
      email,
      role: (role ?? 'pharmacist') as any,
      tokenHash,
      invitedBy: me.sub,
      expiresAt,
    });

    const dashUrl = process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
    const inviteUrl = `${dashUrl}/signup/accept?token=${token}`;
    const resendKey = process.env.RESEND_API_KEY;
    const senderDomain = process.env.SENDER_DOMAIN ?? 'mydashrx.com';

    if (resendKey) {
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: `MyDashRx <noreply@${senderDomain}>`,
          to: email,
          subject: "You've been invited to MyDashRx",
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
              <h2 style="color:#0F4C81;margin:0 0 8px">You're invited to MyDashRx</h2>
              <p style="color:#374151;margin:0 0 24px;font-size:15px">Click below to create your account. This invitation expires in 7 days.</p>
              <a href="${inviteUrl}" style="display:inline-block;background:#0F4C81;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:600;">Accept Invitation</a>
              <p style="color:#9ca3af;font-size:12px;margin-top:24px">If you weren't expecting this, ignore this email.</p>
            </div>`,
        }),
      }).catch((e: unknown) => { console.error('[Resend] invite email failed:', e); });
    }

    return reply.code(201).send({ message: `Invitation sent to ${email}` });
  });

  // ─── Accept Staff Invitation ──────────────────────────────────────────────
  app.post('/invite/accept', async (req, reply) => {
    const parsed = acceptInviteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    const { token, name } = parsed.data;

    const INVITE_SECRET = process.env.MAGIC_LINK_SECRET ?? process.env.JWT_SECRET ?? 'fallback';
    const tokenHash = createHmac('sha256', INVITE_SECRET).update(token).digest('hex');
    const [invite] = await db
      .select()
      .from(staffInvitations)
      .where(and(
        isNull(staffInvitations.acceptedAt),
        gt(staffInvitations.expiresAt, new Date()),
      ))
      .limit(1);

    // Timing-safe comparison to prevent oracle attacks
    const validInvite = invite && (() => {
      try {
        const a = Buffer.from(invite.tokenHash, 'hex');
        const b = Buffer.from(tokenHash, 'hex');
        return a.length === b.length && timingSafeEqual(a, b);
      } catch { return false; }
    })();
    if (!validInvite) return reply.code(400).send({ error: 'This invitation is invalid or has expired.' });

    const existing = await findUserByEmail(invite.email);
    if (existing) {
      await db.update(staffInvitations).set({ acceptedAt: new Date() }).where(eq(staffInvitations.id, invite.id));
      const tokens = signTokens(app, {
        sub: existing.id, email: existing.email, role: existing.role,
        orgId: existing.orgId, depotIds: existing.depotIds as string[],
      });
      return reply.send({ ...tokens, user: { id: existing.id, name: existing.name, email: existing.email, role: existing.role, orgId: existing.orgId, depotIds: existing.depotIds } });
    }

    const passwordHash = await hashPassword(randomBytes(32).toString('hex'));
    const [user] = await db.insert(users).values({
      orgId: invite.orgId, email: invite.email, passwordHash, name, role: invite.role, mustChangePassword: true,
    }).returning();

    await db.update(staffInvitations).set({ acceptedAt: new Date() }).where(eq(staffInvitations.id, invite.id));

    const tokens = signTokens(app, {
      sub: user.id, email: user.email, role: user.role, orgId: user.orgId, depotIds: [],
    });
    return reply.code(201).send({
      ...tokens,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.orgId, depotIds: [] },
    });
  });

  // ─── Validate invitation token (for frontend pre-fill) ───────────────────
  app.get('/invite/validate', async (req, reply) => {
    const { token } = req.query as { token?: string };
    if (!token) return reply.code(400).send({ error: 'Token required' });

    const INVITE_SECRET = process.env.MAGIC_LINK_SECRET ?? process.env.JWT_SECRET ?? 'fallback';
    const tokenHash = createHmac('sha256', INVITE_SECRET).update(token).digest('hex');
    const [invite] = await db
      .select({ email: staffInvitations.email, role: staffInvitations.role, expiresAt: staffInvitations.expiresAt })
      .from(staffInvitations)
      .where(and(
        eq(staffInvitations.tokenHash, tokenHash),
        isNull(staffInvitations.acceptedAt),
        gt(staffInvitations.expiresAt, new Date()),
      ))
      .limit(1);

    if (!invite) return reply.code(400).send({ error: 'This invitation is invalid or has expired.' });
    return reply.send({ email: invite.email, role: invite.role });
  });
};
