import type { FastifyPluginAsync } from 'fastify';
import { createHmac, timingSafeEqual, randomBytes } from 'crypto';
import { z } from 'zod';
import { db } from '../db/connection.js';
import { organizations, users, drivers, staffInvitations, signupIntents } from '../db/schema.js';
import { eq, and, isNull, gt, sql } from 'drizzle-orm';
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const disposableDomains: string[] = _require('disposable-email-domains');
import { hashPassword, signTokens, findUserByEmail } from '../services/auth.js';

const pharmacySignupSchema = z.object({
  orgName: z.string().min(2).max(120),
  orgPhone: z.string().min(7).max(20).optional(),
  orgAddress: z.string().min(5).max(200).optional(),
  adminName: z.string().min(2).max(100),
  adminEmail: z.string().email(),
  npiNumber: z.string().regex(/^\d{10}$/).optional(), // P-ADM27
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

/** P-ADM27: Call NPPES free API to verify NPI — fail-open with 2s timeout */
async function verifyNpi(npi: string): Promise<'valid' | 'invalid' | 'unknown'> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(`https://npiregistry.cms.hhs.gov/api/?number=${npi}&version=2.1`, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) return 'unknown';
    const data = await res.json() as { result_count?: number };
    return (data.result_count ?? 0) > 0 ? 'valid' : 'invalid';
  } catch { return 'unknown'; }
}

async function assessSignupRisk(
  orgName: string,
  adminEmail: string,
  npiNumber?: string,
): Promise<{ flags: string[]; score: number; tier: string; npiVerified: boolean }> {
  const flags: string[] = [];
  const domain = adminEmail.split('@')[1]?.toLowerCase() ?? '';
  if ((disposableDomains as string[]).includes(domain)) flags.push('disposable_email');
  const similar = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(sql`lower(${organizations.name}) ILIKE ${`%${orgName.toLowerCase().slice(0, 10)}%`}`)
    .limit(3);
  if (similar.length > 0) flags.push('similar_org_name');

  // P-ADM27: NPI verification — +40 if invalid, -10 if verified
  let npiVerified = false;
  if (npiNumber) {
    const npiStatus = await verifyNpi(npiNumber);
    if (npiStatus === 'invalid') { flags.push('invalid_npi'); }
    else if (npiStatus === 'valid') { npiVerified = true; }
  }

  // P-ADM22: weighted risk score + trust tier routing
  const WEIGHTS: Record<string, number> = { disposable_email: 30, similar_org_name: 25, invalid_npi: 40 };
  const rawScore = flags.reduce((sum, f) => sum + (WEIGHTS[f] ?? 5), 0);
  const score = Math.min(100, npiVerified ? Math.max(0, rawScore - 10) : rawScore);
  const hasDisposable = flags.includes('disposable_email');
  const hasSimilar = flags.includes('similar_org_name');
  const tier = (score > 70 || (hasDisposable && hasSimilar)) ? 'block'
    : (score <= 15 && !hasDisposable) ? 'auto_approve'
    : 'manual';

  return { flags, score, tier, npiVerified };
}

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
      track_clicks: false,
      track_opens: false,
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
        track_clicks: false,
        track_opens: false,
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

  // P-ADM13: Slack webhook notification
  const slackWebhook = process.env.SLACK_WEBHOOK_URL;
  if (slackWebhook) {
    fetch(slackWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*New pharmacy signup — review needed*\n*Org:* ${orgName}\n*Admin:* ${adminEmail}` },
          },
          {
            type: 'actions',
            elements: [{ type: 'button', text: { type: 'plain_text', text: 'Review in Admin Panel →' }, url: `${dashUrl}/admin/approvals`, style: 'primary' }],
          },
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: `SLA: respond within 4 hours · Sent ${new Date().toUTCString()}` }],
          },
        ],
      }),
    }).catch((e: unknown) => { console.error('[Slack] pharmacy signup notify failed:', e); });
  }
}

export const signupRoutes: FastifyPluginAsync = async (app) => {
  // ─── Pharmacy Owner Signup ────────────────────────────────────────────────
  app.post('/pharmacy', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const parsed = pharmacySignupSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    const { orgName, orgPhone, orgAddress, adminName, adminEmail, npiNumber } = parsed.data;

    const existing = await findUserByEmail(adminEmail);
    if (existing) return reply.code(409).send({ error: 'An account with this email already exists.' });

    const { flags: riskFlags, score: riskScore, tier: trustTier, npiVerified } = await assessSignupRisk(orgName, adminEmail, npiNumber);

    const [org] = await db.insert(organizations).values({
      name: orgName,
      pendingApproval: true,
      ...(riskFlags.length > 0 ? { riskFlags } : {}),
      riskScore,
      trustTier,
      ...(npiNumber ? { npiNumber, npiVerified, ...(npiVerified ? { npiVerifiedAt: new Date() } : {}) } : {}),
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

    // P-CNV15: return tier so frontend can show correct approval timeline
    // Never surface 'block' — treat as 'manual' to avoid tipping off bad actors
    const displayTier = trustTier === 'auto_approve' ? 'auto_approve' : 'manual';
    return reply.code(201).send({ message: 'Application submitted. You will hear from us within 2–4 business hours.', tier: displayTier });
  });

  // ─── P-CNV14: Abandonment Intent Capture ─────────────────────────────────
  // Fire-and-forget from frontend on email blur in Step 2
  // No auth required — unauthenticated endpoint, email is the only PII
  app.post('/pharmacy-intent', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { adminEmail, orgName } = req.body as { adminEmail?: string; orgName?: string };
    if (!adminEmail || !z.string().email().safeParse(adminEmail).success) {
      return reply.code(400).send({ error: 'Valid email required' });
    }
    // Idempotent — skip if email already has a live signup or a recent intent
    const existing = await findUserByEmail(adminEmail);
    if (existing) return reply.code(200).send({ recorded: false, reason: 'user_exists' });

    const [recentIntent] = await db.select({ id: signupIntents.id })
      .from(signupIntents)
      .where(eq(signupIntents.adminEmail, adminEmail))
      .limit(1);
    if (recentIntent) return reply.code(200).send({ recorded: false, reason: 'already_captured' });

    await db.insert(signupIntents).values({ adminEmail, orgName: orgName ?? null });
    return reply.code(201).send({ recorded: true });
  });

  // ─── P-CNV14: Unsubscribe from abandonment emails ────────────────────────
  app.get('/pharmacy-intent/unsubscribe', async (req, reply) => {
    const { email } = req.query as { email?: string };
    if (email) {
      await db.update(signupIntents)
        .set({ unsubscribedAt: new Date() })
        .where(eq(signupIntents.adminEmail, email));
    }
    return reply.type('text/html').send('<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>You\'ve been unsubscribed.</h2><p>You won\'t receive any more emails from MyDashRx signup reminders.</p></body></html>');
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
    const INVITE_SECRET = process.env.MAGIC_LINK_SECRET ?? process.env.JWT_SECRET;
    if (!INVITE_SECRET) throw new Error('MAGIC_LINK_SECRET or JWT_SECRET must be set in env');
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
          track_clicks: false,
          track_opens: false,
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

    const INVITE_SECRET = process.env.MAGIC_LINK_SECRET ?? process.env.JWT_SECRET;
    if (!INVITE_SECRET) throw new Error('MAGIC_LINK_SECRET or JWT_SECRET must be set in env');
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

  // ─── P-ADM28: Reapply after rejection ────────────────────────────────────
  // POST /signup/reapply — HMAC-tokenized link from rejection email
  // Clears rejectedAt, re-runs risk scoring, sets reappliedAt, re-queues for review
  app.post('/reapply', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { orgId, exp, sig, npiNumber } = req.body as {
      orgId?: string; exp?: string; sig?: string; npiNumber?: string;
    };
    if (!orgId || !exp || !sig) return reply.code(400).send({ error: 'Missing parameters' });

    const secret = process.env.MAGIC_LINK_SECRET ?? process.env.JWT_SECRET;
    if (!secret) throw new Error('MAGIC_LINK_SECRET or JWT_SECRET must be set in env');
    const payload = `reapply:${orgId}:${exp}`;
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    try {
      const sigBuf = Buffer.from(sig, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        return reply.code(401).send({ error: 'Invalid or tampered reapply link' });
      }
    } catch { return reply.code(401).send({ error: 'Invalid signature' }); }
    if (Math.floor(Date.now() / 1000) > parseInt(exp, 10)) {
      return reply.code(410).send({ error: 'Reapply link expired — please contact support@mydashrx.com' });
    }

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return reply.code(404).send({ error: 'Organization not found' });
    if (!org.rejectedAt) return reply.code(409).send({ error: 'Organization is not in rejected state' });

    // Re-run risk assessment with optional new NPI
    const [admin] = await db.select({ email: users.email, name: users.name })
      .from(users).where(and(eq(users.orgId, orgId), eq(users.role, 'pharmacy_admin'), isNull(users.deletedAt))).limit(1);

    const { flags: riskFlags, score: riskScore, tier: trustTier, npiVerified } =
      await assessSignupRisk(org.name, admin?.email ?? '', npiNumber);

    await db.update(organizations).set({
      rejectedAt: null,
      rejectionReason: null,
      rejectionNote: null,
      pendingApproval: true,
      reappliedAt: new Date(),
      riskFlags: riskFlags.length > 0 ? riskFlags : null,
      riskScore,
      trustTier,
      ...(npiNumber ? { npiNumber, npiVerified, ...(npiVerified ? { npiVerifiedAt: new Date() } : {}) } : {}),
    }).where(eq(organizations.id, orgId));

    if (admin) {
      await db.update(users).set({ pendingApproval: true })
        .where(and(eq(users.orgId, orgId), isNull(users.deletedAt)));
      notifySuperAdmins(org.name, admin.email).catch(() => {});
    }

    return reply.send({ message: 'Reapplication submitted. Our team will review within 2–4 business hours.' });
  });

  // ─── Validate invitation token (for frontend pre-fill) ───────────────────
  app.get('/invite/validate', async (req, reply) => {
    const { token } = req.query as { token?: string };
    if (!token) return reply.code(400).send({ error: 'Token required' });

    const INVITE_SECRET = process.env.MAGIC_LINK_SECRET ?? process.env.JWT_SECRET;
    if (!INVITE_SECRET) throw new Error('MAGIC_LINK_SECRET or JWT_SECRET must be set in env');
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
