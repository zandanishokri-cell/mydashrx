import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createHash, createHmac, randomBytes } from 'crypto';

const MAGIC_LINK_SECRET = process.env.MAGIC_LINK_SECRET ?? randomBytes(32).toString('hex');
const signToken = (t: string) => createHmac('sha256', MAGIC_LINK_SECRET).update(t).digest('hex');
import { db } from '../db/connection.js';
import { users, organizations, drivers, magicLinkTokens } from '../db/schema.js';
import { eq, and, isNull, gt, count } from 'drizzle-orm';

import { findUserByEmail, findUserById, verifyPassword, signTokens, hashPassword } from '../services/auth.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const registerSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  // Only drivers may self-register. Pharmacists must be invited via Settings → Team.
  role: z.literal('driver'),
  depotId: z.string().uuid().optional(),
});

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    const { email, password } = parsed.data;

    const user = await findUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    if (user.deletedAt) return reply.code(401).send({ error: 'Account deactivated' });
    if (user.pendingApproval) return reply.code(403).send({ pendingApproval: true, error: 'Your account is pending admin approval.' });

    // For drivers, look up their drivers table record to include driverId in JWT
    let driverId: string | undefined;
    if (user.role === 'driver') {
      const [driverRecord] = await db.select({ id: drivers.id }).from(drivers)
        .where(and(eq(drivers.email, user.email), eq(drivers.orgId, user.orgId), isNull(drivers.deletedAt))).limit(1);
      driverId = driverRecord?.id;
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      orgId: user.orgId,
      depotIds: user.depotIds as string[],
      ...(driverId ? { driverId } : {}),
    };
    const tokens = signTokens(app, payload);
    return reply.send({
      ...tokens,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.orgId, depotIds: user.depotIds, mustChangePassword: user.mustChangePassword, ...(driverId ? { driverId } : {}) },
    });
  });

  // Self-registration for drivers and pharmacy staff
  app.post('/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    const { name, email, password, role, depotId } = parsed.data;

    const existing = await findUserByEmail(email);
    // Return 409 without confirming email existence (HIPAA: prevent enumeration)
    if (existing) return reply.code(409).send({ error: 'Registration could not be completed' });

    // Find the org — use the first org (single-tenant for now)
    const [org] = await db.select().from(organizations).limit(1);
    if (!org) return reply.code(500).send({ error: 'No organization configured' });

    const passwordHash = await hashPassword(password);
    const depotIds = depotId ? [depotId] : [];

    const [user] = await db.insert(users).values({
      orgId: org.id, email, passwordHash, name, role, depotIds,
    }).returning();

    // For drivers: also create a drivers record so they appear in dispatcher's driver list
    let driverId: string | undefined;
    if (role === 'driver') {
      const [driverRecord] = await db.insert(drivers).values({
        orgId: org.id, name, email, phone: '', passwordHash, vehicleType: 'car',
      }).returning();
      driverId = driverRecord.id;
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      orgId: user.orgId,
      depotIds: user.depotIds as string[],
      ...(driverId ? { driverId } : {}),
    };
    const tokens = signTokens(app, payload);
    return reply.code(201).send({
      ...tokens,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.orgId, depotIds: user.depotIds, ...(driverId ? { driverId } : {}) },
    });
  });

  app.post('/refresh', async (req, reply) => {
    const body = req.body as { refreshToken?: string };
    if (!body.refreshToken) return reply.code(400).send({ error: 'refreshToken required' });
    try {
      const decoded = app.jwt.verify(body.refreshToken) as { sub: string; type: string };
      if (decoded.type !== 'refresh') throw new Error('wrong token type');
      const user = await findUserById(decoded.sub);
      if (!user) return reply.code(401).send({ error: 'User not found' });
      // Re-attach driverId for driver role — omitting it causes empty route list after token expiry
      let driverId: string | undefined;
      if (user.role === 'driver') {
        const [driverRecord] = await db.select({ id: drivers.id }).from(drivers)
          .where(and(eq(drivers.email, user.email), eq(drivers.orgId, user.orgId), isNull(drivers.deletedAt))).limit(1);
        driverId = driverRecord?.id;
      }
      const tokens = signTokens(app, {
        sub: user.id,
        email: user.email,
        role: user.role,
        orgId: user.orgId,
        depotIds: user.depotIds as string[],
        ...(driverId ? { driverId } : {}),
      });
      return reply.send(tokens);
    } catch {
      return reply.code(401).send({ error: 'Invalid refresh token' });
    }
  });

  app.get('/me', async (req, reply) => {
    try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    const payload = req.user as { sub: string };
    const user = await findUserById(payload.sub);
    if (!user) return reply.code(404).send({ error: 'User not found' });
    return { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.orgId, depotIds: user.depotIds, mustChangePassword: user.mustChangePassword };
  });

  // ─── Magic Link ───────────────────────────────────────────────────────────────
  app.post('/magic-link/request', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const start = Date.now();
    const minResponse = async () => {
      const elapsed = Date.now() - start;
      if (elapsed < 200) await new Promise(r => setTimeout(r, 200 - elapsed));
    };

    const { email } = req.body as { email?: string };
    if (!email || !z.string().email().safeParse(email).success) {
      return reply.code(400).send({ error: 'Valid email required' });
    }

    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const [{ value: recentCount }] = await db
      .select({ value: count() })
      .from(magicLinkTokens)
      .where(and(eq(magicLinkTokens.email, email), gt(magicLinkTokens.createdAt, tenMinAgo)));

    // Always return the same message — never reveal rate limit or account existence
    const ok = { message: 'If an account exists, a login link has been sent to that address.' };
    if (recentCount >= 3) { await minResponse(); return reply.send(ok); }

    // Invalidate any prior unused tokens for this email — only the newest link works
    await db.update(magicLinkTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(magicLinkTokens.email, email), isNull(magicLinkTokens.usedAt)));

    const token = randomBytes(32).toString('hex');
    const tokenHash = signToken(token);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await db.insert(magicLinkTokens).values({ email, tokenHash, expiresAt });

    const user = await findUserByEmail(email);
    if (user && !user.deletedAt) {
      const dashUrl = process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
      const magicUrl = `${dashUrl}/auth/verify?token=${token}`;
      const resendKey = process.env.RESEND_API_KEY;
      const senderDomain = process.env.SENDER_DOMAIN ?? 'mydashrx.com';

      if (resendKey) {
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({
            from: `MyDashRx <noreply@${senderDomain}>`,
            to: email,
            subject: 'Your MyDashRx login link',
            html: `
              <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
                <h2 style="color:#0F4C81;margin:0 0 8px">Sign in to MyDashRx</h2>
                <p style="color:#374151;margin:0 0 24px;font-size:15px">Click the button below to sign in. This link expires in 15 minutes and can only be used once.</p>
                <a href="${magicUrl}" style="display:inline-block;background:#0F4C81;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:600;">Sign in to MyDashRx</a>
                <p style="color:#9ca3af;font-size:12px;margin-top:24px">If you didn't request this, you can safely ignore this email.</p>
              </div>`,
          }),
        }).catch((e: unknown) => { console.error('[Resend] magic-link email failed:', e); });
      }
    }

    await minResponse();
    return reply.send(ok);
  });

  app.get('/magic-link/verify', async (req, reply) => {
    const { token } = req.query as { token?: string };
    if (!token) return reply.code(400).send({ error: 'Token required' });

    const tokenHash = signToken(token);
    const [record] = await db
      .select()
      .from(magicLinkTokens)
      .where(and(
        eq(magicLinkTokens.tokenHash, tokenHash),
        isNull(magicLinkTokens.usedAt),
        gt(magicLinkTokens.expiresAt, new Date()),
      ))
      .limit(1);

    if (!record) return reply.code(400).send({ error: 'This link is invalid or has expired. Please request a new one.' });

    await db.update(magicLinkTokens).set({ usedAt: new Date() }).where(eq(magicLinkTokens.id, record.id));

    const user = await findUserByEmail(record.email);
    if (!user || user.deletedAt) return reply.code(404).send({ error: 'No account found for this email.' });
    if (user.pendingApproval) return reply.code(403).send({ pendingApproval: true, error: 'Your account is pending admin approval. You will receive an email when approved.' });

    let driverId: string | undefined;
    if (user.role === 'driver') {
      const [dr] = await db.select({ id: drivers.id }).from(drivers)
        .where(and(eq(drivers.email, user.email), eq(drivers.orgId, user.orgId), isNull(drivers.deletedAt))).limit(1);
      driverId = dr?.id;
    }

    const tokens = signTokens(app, {
      sub: user.id, email: user.email, role: user.role, orgId: user.orgId,
      depotIds: user.depotIds as string[], ...(driverId ? { driverId } : {}),
    });
    return reply.send({
      ...tokens,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.orgId, depotIds: user.depotIds, mustChangePassword: user.mustChangePassword, ...(driverId ? { driverId } : {}) },
    });
  });

  app.post('/change-password', async (req, reply) => {
    try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    const payload = req.user as { sub: string };
    const { newPassword } = req.body as { newPassword?: string };
    if (!newPassword || newPassword.length < 8) return reply.code(400).send({ error: 'Password must be at least 8 characters' });

    const user = await findUserById(payload.sub);
    if (!user) return reply.code(404).send({ error: 'User not found' });

    const newHash = await hashPassword(newPassword);
    const [updated] = await db.update(users)
      .set({ passwordHash: newHash, mustChangePassword: false })
      .where(eq(users.id, payload.sub))
      .returning({ id: users.id, name: users.name, email: users.email, role: users.role, orgId: users.orgId, depotIds: users.depotIds, mustChangePassword: users.mustChangePassword });

    // Keep drivers.passwordHash in sync — prevents stale hash if a direct-driver-auth path is ever added
    if (user.role === 'driver') {
      await db.update(drivers).set({ passwordHash: newHash })
        .where(and(eq(drivers.email, user.email), eq(drivers.orgId, user.orgId), isNull(drivers.deletedAt)));
    }

    return { user: updated };
  });
};
