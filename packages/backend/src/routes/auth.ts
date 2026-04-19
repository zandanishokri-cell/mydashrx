import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createHmac, randomBytes, randomUUID } from 'crypto';
import { promises as dnsPromises } from 'dns';

const MAGIC_LINK_SECRET = process.env.MAGIC_LINK_SECRET ?? process.env.JWT_SECRET ?? randomBytes(32).toString('hex');
const signToken = (t: string) => createHmac('sha256', MAGIC_LINK_SECRET).update(t).digest('hex');

// P-ML-DNSCHECK: MX record validation — fail-open (2s timeout, any error = valid)
async function hasMxRecord(email: string): Promise<boolean> {
  const domain = email.split('@')[1];
  if (!domain) return false;
  try {
    const records = await Promise.race([
      dnsPromises.resolveMx(domain),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('dns_timeout')), 2000)),
    ]);
    return Array.isArray(records) && records.length > 0;
  } catch {
    return true; // fail-open: valid domains on slow DNS still get email
  }
}
import { db } from '../db/connection.js';
import { users, organizations, drivers, magicLinkTokens, refreshTokens, adminAuditLogs } from '../db/schema.js';
import { eq, and, isNull, gt, count, desc, asc, inArray, ne } from 'drizzle-orm';

import { findUserByEmail, findUserById, verifyPassword, signTokens, hashPassword } from '../services/auth.js';
import { sql } from 'drizzle-orm';
import { createHash } from 'crypto';

// P-SEC11: HIPAA auth audit log — non-blocking, never fails auth flows
async function logAuthEvent(
  event: string,
  opts: { userId?: string; email: string; ip: string; orgId?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  const zeroId = '00000000-0000-0000-0000-000000000000';
  try {
    await db.insert(adminAuditLogs).values({
      actorId: opts.userId ?? zeroId,
      actorEmail: opts.email,
      action: event,
      targetId: opts.userId ?? zeroId,
      targetName: opts.email,
      metadata: { ip: opts.ip, ...(opts.orgId ? { orgId: opts.orgId } : {}), ...opts.metadata },
    });
  } catch { /* non-blocking */ }
}

// P-SEC12: HIBP k-anonymity breach detection — fail open on any error
async function isPasswordPwned(password: string): Promise<boolean> {
  try {
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: controller.signal,
      headers: { 'Add-Padding': 'true' },
    });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const text = await res.text();
    return text.split('\r\n').some(line => line.toUpperCase().startsWith(suffix));
  } catch {
    return false;
  }
}

const SESSION_CAP = 50;

async function enforceSessionCap(userId: string): Promise<void> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(refreshTokens)
    .where(and(eq(refreshTokens.userId, userId), eq(refreshTokens.status, 'active')));

  const over = (total ?? 0) - SESSION_CAP + 1; // +1 to make room for the new session just inserted
  if (over <= 0) return;

  const lru = await db
    .select({ jti: refreshTokens.jti })
    .from(refreshTokens)
    .where(and(eq(refreshTokens.userId, userId), eq(refreshTokens.status, 'active')))
    .orderBy(asc(refreshTokens.createdAt))
    .limit(over);

  if (lru.length > 0) {
    await db.update(refreshTokens)
      .set({ status: 'revoked' })
      .where(inArray(refreshTokens.jti, lru.map(r => r.jti)));
  }
}

// P-SES18: stable device label stored once at RT creation
function buildDeviceName(ua: string | null): string {
  if (!ua) return 'Unknown device';
  if (/iPhone/i.test(ua)) return 'iPhone · ' + (/Safari/i.test(ua) && !/Chrome/i.test(ua) ? 'Safari' : 'App');
  if (/iPad/i.test(ua)) return 'iPad · Safari';
  if (/Android/i.test(ua)) return 'Android · ' + (/Chrome/i.test(ua) ? 'Chrome' : 'App');
  const os = /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Desktop';
  const br = /Edg/i.test(ua) ? 'Edge' : /Firefox/i.test(ua) ? 'Firefox' : /Chrome/i.test(ua) ? 'Chrome' : /Safari/i.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${br}`;
}

async function seedRefreshToken(
  userId: string,
  familyId: string,
  jti: string,
  req: { ip: string; headers: Record<string, string | string[] | undefined> },
): Promise<void> {
  const seedNow = new Date();
  const ua = (req.headers['user-agent'] as string | undefined) ?? null;
  await db.insert(refreshTokens).values({
    jti,
    familyId,
    userId,
    ip: req.ip,
    userAgent: ua,
    deviceName: buildDeviceName(ua), // P-SES18
    lastUsedAt: seedNow, // P-SES16
    absoluteExpiresAt: new Date(seedNow.getTime() + 90 * 24 * 60 * 60 * 1000), // P-SES16: 90d hard cap
    expiresAt: new Date(seedNow.getTime() + 90 * 24 * 60 * 60 * 1000),
  });
  await enforceSessionCap(userId);
}

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

const ipEmailKey = (req: import('fastify').FastifyRequest) => {
  const xff = req.headers['x-forwarded-for'];
  const ip = xff ? (Array.isArray(xff) ? xff[0] : xff).split(',')[0].trim() : req.ip;
  const email = ((req.body as { email?: string } | null)?.email ?? '').toLowerCase();
  return `${ip}:${email}`;
};

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: ipEmailKey } } }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    const { email, password } = parsed.data;

    const user = await findUserByEmail(email);

    // P-LCK1: Check lockout before bcrypt (fast-fail)
    if (user && user.lockedUntil && user.lockedUntil > new Date()) {
      const secsLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
      return reply.code(429).send({ error: `Account temporarily locked. Try again in ${secsLeft}s.` });
    }

    // P-SEC25: Constant-time — always run bcrypt even for unknown emails (prevents timing oracle)
    const passwordValid = user
      ? await verifyPassword(password, user.passwordHash)
      : (await verifyPassword(password, '$2b$10$dummyhashtopreventtimingattacks.xxxxxXXXXXX').catch(() => false), false);

    if (!user || !passwordValid) {
      // P-LCK1: Increment failed attempts on wrong password
      if (user) {
        const attempts = (user.failedLoginAttempts ?? 0) + 1;
        const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60_000) : null;

        // P-LCK1-EMAIL: Security alert on 3rd attempt
        if (attempts === 3) {
          const resendKey = process.env.RESEND_API_KEY;
          const senderDomain = process.env.SENDER_DOMAIN ?? 'mydashrx.com';
          const dashUrl = process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
          if (resendKey) {
            fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
              body: JSON.stringify({
                from: `MyDashRx <security@${senderDomain}>`,
                to: user.email,
                subject: '[MyDashRx] Unusual login activity on your account',
                track_clicks: false,
                html: `
                  <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
                    <h2 style="color:#dc2626;margin:0 0 8px">Unusual login activity</h2>
                    <p style="color:#374151;font-size:15px">Hi ${user.name},</p>
                    <p style="color:#374151;font-size:15px">We detected 3 failed login attempts on your MyDashRx account. Your account will be temporarily locked after 2 more failed attempts.</p>
                    <p style="color:#374151;font-size:15px">If this wasn't you, <a href="${dashUrl}/login">reset your password now</a>.</p>
                  </div>`,
              }),
            }).catch((e: unknown) => { console.error('[Security] login alert email failed:', e); });
          }
        }

        await db.update(users).set({
          failedLoginAttempts: attempts,
          ...(lockUntil ? { lockedUntil: lockUntil } : {}),
        }).where(eq(users.id, user.id));
      }
      // P-SEC11: log login_failed (only when user exists — prevents email enumeration)
    if (user) await logAuthEvent('login_failed', { userId: user.id, email: user.email, ip: req.ip, orgId: user.orgId ?? undefined, metadata: { reason: 'wrong_password' } });
    return reply.code(401).send({ error: 'Invalid credentials' });
    }

    if (user.deletedAt) return reply.code(401).send({ error: 'Account deactivated' });
    if (user.pendingApproval) return reply.code(403).send({ pendingApproval: true, error: 'Your account is pending admin approval.' });
    // P-ADM7: Check org rejection state (super_admin always bypasses — they manage orgs, not belong to one)
    if (user.orgId && user.role !== 'super_admin') {
      const [org] = await db.select({ rejectedAt: organizations.rejectedAt, rejectionReason: organizations.rejectionReason })
        .from(organizations).where(eq(organizations.id, user.orgId)).limit(1);
      if (org?.rejectedAt) {
        return reply.code(403).send({ rejected: true, reason: org.rejectionReason, error: 'Your application was not approved.' });
      }
    }

    // P-LCK1: Reset failed attempts on successful login
    if ((user.failedLoginAttempts ?? 0) > 0) {
      await db.update(users)
        .set({ failedLoginAttempts: 0, lockedUntil: null })
        .where(eq(users.id, user.id));
    }

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
      ...(user.mustChangePassword ? { mustChangePw: true } : {}),
      ...(driverId ? { driverId } : {}),
    };
    const jti = randomUUID();
    const familyId = randomUUID();
    const tokens = signTokens(app, payload, user.tokenVersion, { jti, familyId });
    await seedRefreshToken(user.id, familyId, jti, req);
    // P-SEC11: log login_success
    await logAuthEvent('login_success', { userId: user.id, email: user.email, ip: req.ip, orgId: user.orgId ?? undefined });
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

  app.post('/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = req.body as { refreshToken?: string };
    if (!body.refreshToken) return reply.code(400).send({ error: 'refreshToken required' });

    let decoded: { sub: string; type: string; tv?: number; jti?: string; familyId?: string };
    try {
      decoded = app.jwt.verify(body.refreshToken) as typeof decoded;
      if (decoded.type !== 'refresh') throw new Error('wrong type');
    } catch {
      return reply.code(401).send({ error: 'Invalid refresh token' });
    }

    // --- Stateful path: jti present = token was seeded on login ---
    if (decoded.jti) {
      const jti = decoded.jti;
      let txStatus: 'not_found' | 'used' | 'revoked' | 'active' = 'not_found';
      let txFamilyId = '';

      let txStoredIp: string | null = null;
      let txStoredUa: string | null = null;

      // P-SES16: 14d idle window — check lastUsedAt before the FOR UPDATE lock
      const [rtCheck] = await db.select({
        lastUsedAt: refreshTokens.lastUsedAt,
        absoluteExpiresAt: refreshTokens.absoluteExpiresAt,
        status: refreshTokens.status,
      }).from(refreshTokens).where(eq(refreshTokens.jti, jti)).limit(1);
      if (rtCheck) {
        const IDLE_LIMIT_MS = 14 * 24 * 3600_000; // 14 days
        const lastActivity = rtCheck.lastUsedAt ?? null;
        if (lastActivity && Date.now() - new Date(lastActivity).getTime() > IDLE_LIMIT_MS) {
          await db.update(refreshTokens).set({ status: 'revoked' }).where(eq(refreshTokens.jti, jti));
          return reply.code(401).send({ error: 'Session expired due to inactivity. Please log in again.' });
        }
        if (rtCheck.absoluteExpiresAt && new Date(rtCheck.absoluteExpiresAt) < new Date()) {
          await db.update(refreshTokens).set({ status: 'revoked' }).where(eq(refreshTokens.jti, jti));
          return reply.code(401).send({ error: 'Session maximum lifetime reached. Please log in again.' });
        }
      }

      await db.transaction(async (tx) => {
        const rows = await tx.execute(
          sql`SELECT id, family_id, status, ip, user_agent FROM refresh_tokens WHERE jti = ${jti} FOR UPDATE`
        );
        const row = (rows as unknown as Array<{ id: string; family_id: string; status: string; ip: string | null; user_agent: string | null }>)[0];
        if (!row) return;
        if (row.status === 'used') {
          txStatus = 'used';
          await tx.update(refreshTokens).set({ status: 'revoked' }).where(eq(refreshTokens.familyId, row.family_id));
          console.warn(JSON.stringify({ event: 'rt_replay_detected', familyId: row.family_id, ip: req.ip, ua: req.headers['user-agent'], ts: new Date().toISOString() }));
          return;
        }
        if (row.status === 'revoked') { txStatus = 'revoked'; return; }
        txStatus = 'active';
        txFamilyId = row.family_id;
        txStoredIp = row.ip;
        txStoredUa = row.user_agent;
        await tx.update(refreshTokens).set({ status: 'used', usedAt: new Date() }).where(eq(refreshTokens.jti, jti));
      });

      if (txStatus === 'not_found') return reply.code(401).send({ error: 'Unknown token' });
      if (txStatus === 'used') return reply.code(401).send({ error: 'Token reuse detected. All sessions revoked.' });
      if (txStatus === 'revoked') return reply.code(401).send({ error: 'Session revoked. Please log in again.' });

      // P-SEC7: IP/UA binding mismatch — log only (Phase 1), don't reject (mobile IPs change)
      const ipMismatch = txStoredIp && txStoredIp !== req.ip;
      const uaMismatch = txStoredUa && txStoredUa !== req.headers['user-agent'];
      if (ipMismatch || uaMismatch) {
        console.warn(JSON.stringify({ event: 'rt_binding_mismatch', storedIp: txStoredIp, requestIp: req.ip, uaMismatch: !!uaMismatch, ts: new Date().toISOString() }));
      }

      const user = await findUserById(decoded.sub);
      if (!user || user.deletedAt) return reply.code(401).send({ error: 'User not found' });
      if (decoded.tv !== undefined && decoded.tv !== user.tokenVersion) {
        console.warn(JSON.stringify({ event: 'rt_token_version_mismatch', userId: user.id, storedTv: decoded.tv, currentTv: user.tokenVersion, ip: req.ip, ts: new Date().toISOString() }));
        return reply.code(401).send({ error: 'Session invalidated. Please log in again.' });
      }

      let driverId: string | undefined;
      if (user.role === 'driver') {
        const [dr] = await db.select({ id: drivers.id }).from(drivers)
          .where(and(eq(drivers.email, user.email), eq(drivers.orgId, user.orgId), isNull(drivers.deletedAt))).limit(1);
        driverId = dr?.id;
      }

      const newJti = randomUUID();
      const tokens = signTokens(app, {
        sub: user.id, email: user.email, role: user.role, orgId: user.orgId,
        depotIds: user.depotIds as string[],
        ...(user.mustChangePassword ? { mustChangePw: true } : {}),
        ...(driverId ? { driverId } : {}),
      }, user.tokenVersion, { jti: newJti, familyId: txFamilyId });

      const now = new Date();
      await db.insert(refreshTokens).values({
        jti: newJti,
        familyId: txFamilyId,
        userId: user.id,
        ip: req.ip,
        userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
        lastUsedAt: now, // P-SES16: track last activity for idle expiry
        absoluteExpiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000), // 90d absolute cap
        expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
      });

      console.log(JSON.stringify({ event: 'rt_rotated', userId: user.id, familyId: txFamilyId, ip: req.ip, ts: now.toISOString() }));
      return reply.send(tokens);
    }

    // --- Stateless fallback: pre-P-SES3 tokens without jti. Migrate to stateful on first use. ---
    try {
      const user = await findUserById(decoded.sub);
      if (!user) return reply.code(401).send({ error: 'User not found' });
      if (decoded.tv !== undefined && decoded.tv !== user.tokenVersion) {
        return reply.code(401).send({ error: 'Session invalidated. Please log in again.' });
      }
      let driverId: string | undefined;
      if (user.role === 'driver') {
        const [dr] = await db.select({ id: drivers.id }).from(drivers)
          .where(and(eq(drivers.email, user.email), eq(drivers.orgId, user.orgId), isNull(drivers.deletedAt))).limit(1);
        driverId = dr?.id;
      }
      const newJti = randomUUID();
      const newFamilyId = randomUUID();
      const tokens = signTokens(app, {
        sub: user.id, email: user.email, role: user.role, orgId: user.orgId,
        depotIds: user.depotIds as string[],
        ...(user.mustChangePassword ? { mustChangePw: true } : {}),
        ...(driverId ? { driverId } : {}),
      }, user.tokenVersion, { jti: newJti, familyId: newFamilyId });
      await seedRefreshToken(user.id, newFamilyId, newJti, req);
      return reply.send(tokens);
    } catch {
      return reply.code(401).send({ error: 'Invalid refresh token' });
    }
  });

  app.post('/logout', async (req, reply) => {
    const refreshToken = (req.body as { refreshToken?: string } | null | undefined)?.refreshToken;
    if (refreshToken) {
      try {
        const decoded = app.jwt.verify(refreshToken) as { jti?: string; sub?: string };
        if (decoded.jti) {
          await db.update(refreshTokens).set({ status: 'revoked' })
            .where(eq(refreshTokens.jti, decoded.jti)).catch(() => {});
        }
        // P-SEC11: log logout
        if (decoded.sub) {
          const u = await findUserById(decoded.sub);
          if (u) await logAuthEvent('logout', { userId: u.id, email: u.email, ip: req.ip, orgId: u.orgId ?? undefined });
        }
      } catch { /* invalid token — no-op, silent */ }
    }
    return reply.code(204).send();
  });

  app.get('/me', async (req, reply) => {
    try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    const payload = req.user as { sub: string };
    const user = await findUserById(payload.sub);
    if (!user) return reply.code(404).send({ error: 'User not found' });
    return { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.orgId, depotIds: user.depotIds, mustChangePassword: user.mustChangePassword };
  });

  // ─── Magic Link ───────────────────────────────────────────────────────────────
  app.post('/magic-link/request', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
        keyGenerator: ipEmailKey,
        errorResponseBuilder: (_req: import('fastify').FastifyRequest, context: import('@fastify/rate-limit').errorResponseBuilderContext) => {
          const msLeft = context.ttl ?? 60000;
          const minutesLeft = Math.max(1, Math.ceil(msLeft / 60000));
          return {
            statusCode: 429,
            error: 'rate_limited',
            message: `A login link was already sent to that email. Check your inbox — including spam. If you need a new link, try again in ${minutesLeft} minute${minutesLeft > 1 ? 's' : ''}.`,
            hint: "Check your spam or promotions folder if you don't see it.",
            retryAfterSeconds: Math.ceil(msLeft / 1000),
          };
        },
      },
    },
  }, async (req, reply) => {
    const start = Date.now();
    const minResponse = async () => {
      const elapsed = Date.now() - start;
      if (elapsed < 200) await new Promise(r => setTimeout(r, 200 - elapsed));
    };

    const { email } = req.body as { email?: string };
    if (!email || !z.string().email().safeParse(email).success) {
      return reply.code(400).send({ error: 'Valid email required' });
    }

    // P-ML-DNSCHECK: validate MX record exists (fail-open, generic error avoids enumeration)
    const mxValid = await hasMxRecord(email);
    if (!mxValid) {
      await minResponse();
      return reply.send({ message: 'If an account exists, a login link has been sent to that address.' });
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
    const otpPlain = Math.floor(100_000 + Math.random() * 900_000).toString();
    const otpCode = createHmac('sha256', MAGIC_LINK_SECRET).update(otpPlain).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    await db.insert(magicLinkTokens).values({ email, tokenHash, otpCode, expiresAt });
    // P-SEC11: log magic_link_requested (non-enumerable — always fires regardless of user existence)
    await logAuthEvent('magic_link_requested', { email, ip: req.ip });

    const user = await findUserByEmail(email);
    if (user && !user.deletedAt) {
      const dashUrl = process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
      const magicUrl = `${dashUrl}/auth/verify?token=${token}`;
      const resendKey = process.env.RESEND_API_KEY;
      const senderDomain = process.env.SENDER_DOMAIN ?? 'mydashrx.com';
      const otpDisplay = `${otpPlain.slice(0, 3)} ${otpPlain.slice(3)}`;

      if (resendKey) {
        const { randomUUID } = await import('crypto');
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({
            from: `MyDashRx <noreply@${senderDomain}>`,
            to: email,
            subject: 'Your MyDashRx login link (expires in 30 min)',
            headers: { 'X-Entity-Ref-ID': randomUUID() },
            track_clicks: false,
            track_opens: false,
            html: `
              <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Click to complete your MyDashRx sign-in. This link expires in 15 minutes.</span>
              <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
                <h2 style="color:#0F4C81;margin:0 0 8px">Sign in to MyDashRx</h2>
                <p style="color:#374151;margin:0 0 24px;font-size:15px">Click the button below to sign in. This link expires in 30 minutes and can only be used once.</p>
                <a href="${magicUrl}" style="display:inline-block;background:#0F4C81;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:600;">Sign in to MyDashRx</a>
                <div style="margin-top:20px;text-align:center;border-top:1px solid #eee;padding-top:16px">
                  <p style="color:#666;font-size:13px;margin:0 0 8px">Or enter this code instead:</p>
                  <p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#0F4C81;margin:0">${otpDisplay}</p>
                  <p style="color:#999;font-size:11px;margin:8px 0 0">Works on any device &bull; Expires in 15 min</p>
                </div>
                <p style="color:#9ca3af;font-size:12px;margin-top:24px">If you didn't request this, you can safely ignore this email.</p>
              </div>`,
          }),
        }).catch((e: unknown) => { console.error('[Resend] magic-link email failed:', e); });
      }
    }

    await minResponse();
    return reply.send(ok);
  });

  // P-ML2: Step 1 — GET validates token and records first click, does NOT consume it
  // Scanners pre-fetch GET links; consuming on GET means scanner eats the token before user sees it.
  app.get('/magic-link/verify', async (req, reply) => {
    const { token } = req.query as { token?: string };
    if (!token) return reply.code(400).send({ error: 'Token required' });

    const tokenHash = signToken(token);

    // P-ML4: Granular errors — check existence, then usedAt, then expiry separately
    const [record] = await db.select().from(magicLinkTokens)
      .where(eq(magicLinkTokens.tokenHash, tokenHash)).limit(1);
    if (!record) return reply.code(400).send({ error: 'This link is invalid. Please request a new one.' });
    if (record.usedAt) return reply.code(400).send({ error: 'This link has already been used. Please request a new one.' });
    if (record.expiresAt <= new Date()) return reply.code(400).send({ error: 'This link has expired. Please request a new one.' });

    // P-ML2: Record first click for analytics — but do NOT mark usedAt
    if (!record.firstClickedAt) {
      await db.update(magicLinkTokens).set({ firstClickedAt: new Date() }).where(eq(magicLinkTokens.id, record.id));
    }

    return reply.send({ valid: true, email: record.email, token });
  });

  // P-ML2: Step 2 — POST /magic-link/confirm consumes token and issues JWT
  app.post('/magic-link/confirm', async (req, reply) => {
    const { token } = req.body as { token?: string };
    if (!token) return reply.code(400).send({ error: 'Token required' });

    const tokenHash = signToken(token);

    // P-ML4: Granular errors on confirm too
    const [record] = await db.select().from(magicLinkTokens)
      .where(eq(magicLinkTokens.tokenHash, tokenHash)).limit(1);
    if (!record) return reply.code(400).send({ error: 'This link is invalid. Please request a new one.' });
    if (record.usedAt) return reply.code(400).send({ error: 'This link has already been used. Please request a new one.' });
    if (record.expiresAt <= new Date()) return reply.code(400).send({ error: 'This link has expired. Please request a new one.' });

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

    const mlJti = randomUUID();
    const mlFamilyId = randomUUID();
    const tokens = signTokens(app, {
      sub: user.id, email: user.email, role: user.role, orgId: user.orgId,
      depotIds: user.depotIds as string[],
      ...(user.mustChangePassword ? { mustChangePw: true } : {}),
      ...(driverId ? { driverId } : {}),
    }, user.tokenVersion, { jti: mlJti, familyId: mlFamilyId });
    await seedRefreshToken(user.id, mlFamilyId, mlJti, req);
    // P-SEC11: log magic_link_used
    await logAuthEvent('magic_link_used', { userId: user.id, email: user.email, ip: req.ip, orgId: user.orgId ?? undefined });
    return reply.send({
      ...tokens,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.orgId, depotIds: user.depotIds, mustChangePassword: user.mustChangePassword, ...(driverId ? { driverId } : {}) },
    });
  });

  // P-ML5: OTP fallback — verify 6-digit code instead of clicking magic link
  app.post('/magic-link/verify-code',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const { email, code } = req.body as { email?: string; code?: string };
      if (!email || !z.string().email().safeParse(email).success || !code) {
        return reply.code(400).send({ error: 'Email and 6-digit code required' });
      }
      const normalizedCode = code.replace(/\s/g, '');
      if (!/^\d{6}$/.test(normalizedCode)) {
        return reply.code(400).send({ error: 'Code must be 6 digits' });
      }

      const hashed = createHmac('sha256', MAGIC_LINK_SECRET).update(normalizedCode).digest('hex');

      const user = await findUserByEmail(email);
      if (!user || user.deletedAt) {
        // Constant-time delay to prevent email enumeration
        await new Promise(r => setTimeout(r, 200));
        return reply.code(400).send({ error: 'Invalid or expired code' });
      }

      const [record] = await db.select().from(magicLinkTokens)
        .where(and(
          eq(magicLinkTokens.email, email),
          eq(magicLinkTokens.otpCode, hashed),
          isNull(magicLinkTokens.usedAt),
          gt(magicLinkTokens.expiresAt, new Date()),
        ))
        .orderBy(desc(magicLinkTokens.createdAt))
        .limit(1);

      if (!record) return reply.code(400).send({ error: 'Invalid or expired code' });

      await db.update(magicLinkTokens).set({ usedAt: new Date() }).where(eq(magicLinkTokens.id, record.id));

      if (user.pendingApproval) return reply.code(403).send({ pendingApproval: true, error: 'Your account is pending admin approval.' });

      let driverId: string | undefined;
      if (user.role === 'driver') {
        const [dr] = await db.select({ id: drivers.id }).from(drivers)
          .where(and(eq(drivers.email, user.email), eq(drivers.orgId, user.orgId), isNull(drivers.deletedAt))).limit(1);
        driverId = dr?.id;
      }

      const mlJti = randomUUID();
      const mlFamilyId = randomUUID();
      const tokens = signTokens(app, {
        sub: user.id, email: user.email, role: user.role, orgId: user.orgId,
        depotIds: user.depotIds as string[],
        ...(user.mustChangePassword ? { mustChangePw: true } : {}),
        ...(driverId ? { driverId } : {}),
      }, user.tokenVersion, { jti: mlJti, familyId: mlFamilyId });
      await seedRefreshToken(user.id, mlFamilyId, mlJti, req);
      return reply.send({
        ...tokens,
        user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.orgId, depotIds: user.depotIds, mustChangePassword: user.mustChangePassword, ...(driverId ? { driverId } : {}) },
      });
    },
  );

  app.post('/change-password', async (req, reply) => {
    try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    const payload = req.user as { sub: string };
    const { newPassword } = req.body as { newPassword?: string };
    if (!newPassword || newPassword.length < 8) return reply.code(400).send({ error: 'Password must be at least 8 characters' });

    const user = await findUserById(payload.sub);
    if (!user) return reply.code(404).send({ error: 'User not found' });

    // P-SEC12: HIBP breach detection — block known-breached passwords
    const pwned = await isPasswordPwned(newPassword);
    if (pwned) {
      return reply.code(400).send({ error: 'This password has appeared in a known data breach and cannot be used. Please choose a different password.' });
    }

    const newHash = await hashPassword(newPassword);
    const [updated] = await db.update(users)
      .set({ passwordHash: newHash, mustChangePassword: false })
      .where(eq(users.id, payload.sub))
      .returning({ id: users.id, name: users.name, email: users.email, role: users.role, orgId: users.orgId, depotIds: users.depotIds, mustChangePassword: users.mustChangePassword });

    // P-SEC10: Revoke all active RTs — attacker cannot continue after victim changes password
    await db.update(refreshTokens)
      .set({ status: 'revoked' })
      .where(and(eq(refreshTokens.userId, payload.sub), eq(refreshTokens.status, 'active')));

    // Keep drivers.passwordHash in sync — prevents stale hash if a direct-driver-auth path is ever added
    if (user.role === 'driver') {
      await db.update(drivers).set({ passwordHash: newHash })
        .where(and(eq(drivers.email, user.email), eq(drivers.orgId, user.orgId), isNull(drivers.deletedAt)));
    }

    // P-SEC11: log password_changed
    await logAuthEvent('password_changed', { userId: user.id, email: user.email, ip: req.ip, orgId: user.orgId ?? undefined });

    return { user: updated };
  });

  // GET /auth/sessions — list active sessions (P-SES10, HIPAA §164.312(a)(2)(iii))
  app.get('/sessions', async (req, reply) => {
    try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    const payload = req.user as { sub: string; jti?: string };
    const now = new Date();
    const rows = await db.select({
      jti: refreshTokens.jti,
      ip: refreshTokens.ip,
      userAgent: refreshTokens.userAgent,
      deviceName: refreshTokens.deviceName, // P-SES18
      createdAt: refreshTokens.createdAt,
      lastUsedAt: refreshTokens.lastUsedAt, // P-SES18
      expiresAt: refreshTokens.expiresAt,
    }).from(refreshTokens)
      .where(and(
        eq(refreshTokens.userId, payload.sub),
        eq(refreshTokens.status, 'active'),
        gt(refreshTokens.expiresAt, now),
      ))
      .orderBy(desc(refreshTokens.createdAt))
      .limit(50);
    return rows.map(r => ({ ...r, isCurrent: r.jti === payload.jti }));
  });

  // DELETE /auth/sessions/all — revoke all OTHER sessions (P-SES17, HIPAA §164.312(a)(2)(iii))
  app.delete('/sessions/all', async (req, reply) => {
    try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    const payload = req.user as { sub: string; jti?: string; email?: string; orgId?: string };
    // Revoke all active RTs except current jti so this session stays alive
    const conditions = [
      eq(refreshTokens.userId, payload.sub),
      eq(refreshTokens.status, 'active'),
      ...(payload.jti ? [ne(refreshTokens.jti, payload.jti)] : []),
    ];
    await db.update(refreshTokens).set({ status: 'revoked' }).where(and(...conditions));
    // HIPAA §164.312(a)(2)(iii) — log mass session revocation
    logAuthEvent('sessions_revoked_all', { userId: payload.sub, email: payload.email ?? '', ip: req.ip, orgId: payload.orgId ?? undefined, metadata: { retainedJti: payload.jti } }).catch(() => {});
    return reply.code(204).send();
  });

  // DELETE /auth/sessions/:jti — revoke single session (P-SES10)
  app.delete('/sessions/:jti', async (req, reply) => {
    try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    const payload = req.user as { sub: string };
    const { jti } = req.params as { jti: string };
    const [row] = await db.select({ userId: refreshTokens.userId })
      .from(refreshTokens).where(eq(refreshTokens.jti, jti)).limit(1);
    if (!row) return reply.code(404).send({ error: 'Session not found' });
    if (row.userId !== payload.sub) return reply.code(403).send({ error: 'Forbidden' });
    await db.update(refreshTokens).set({ status: 'revoked' }).where(eq(refreshTokens.jti, jti));
    return reply.code(204).send();
  });

  // POST /auth/token-cookie — P-SES20 Phase 1: store AT+RT in HttpOnly cookies (BFF migration path)
  // Accepts AT+RT from Authorization header (existing localStorage flow), sets HttpOnly cookies
  // This is ADDITIVE — does not break existing localStorage clients
  app.post('/token-cookie', async (req, reply) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return reply.code(401).send({ error: 'Bearer token required' });
    const at = auth.slice(7);
    const body = req.body as { refreshToken?: string } | null;
    const rt = body?.refreshToken;
    const isProduction = process.env.NODE_ENV === 'production';
    // Verify AT is valid before setting cookie
    try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Invalid access token' }); }
    reply.setCookie('at', at, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      path: '/',
      maxAge: 15 * 60, // 15min — matches AT expiry
    });
    if (rt) {
      reply.setCookie('rt', rt, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        path: '/api/v1/auth/refresh',
        maxAge: 90 * 24 * 60 * 60, // 90d — matches RT absolute expiry
      });
    }
    return { ok: true };
  });

  // GET /auth/whoami — P-SES20 Phase 1: read identity from HttpOnly cookie AT
  // Parallel to GET /auth/me (which reads from Authorization header)
  // Allows cookie-based clients to get current user without exposing AT to JS
  app.get('/whoami', async (req, reply) => {
    const cookieAt = (req as unknown as { cookies: Record<string, string> }).cookies?.at;
    if (!cookieAt) return reply.code(401).send({ error: 'No session cookie' });
    try {
      const payload = app.jwt.verify<{ sub: string; email: string; role: string; orgId: string; depotIds: string[] }>(cookieAt);
      const [user] = await db.select({
        id: users.id, name: users.name, email: users.email,
        role: users.role, orgId: users.orgId, depotIds: users.depotIds, mustChangePassword: users.mustChangePassword,
      }).from(users).where(eq(users.id, payload.sub)).limit(1);
      if (!user) return reply.code(401).send({ error: 'User not found' });
      return user;
    } catch {
      return reply.code(401).send({ error: 'Invalid session cookie' });
    }
  });

  // GET /auth/org-status — approval state for authenticated user (P-ADM7)
  app.get('/org-status', async (req, reply) => {
    try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    const { orgId } = req.user as { orgId: string };
    const [org] = await db
      .select({ pendingApproval: organizations.pendingApproval, approvedAt: organizations.approvedAt, rejectedAt: organizations.rejectedAt, rejectionReason: organizations.rejectionReason })
      .from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return reply.code(404).send({ error: 'Organization not found' });
    const status = org.rejectedAt ? 'rejected' : (org.approvedAt || !org.pendingApproval) ? 'approved' : 'pending';
    return {
      status,
      ...(org.rejectedAt ? { reason: org.rejectionReason, rejectedAt: org.rejectedAt } : {}),
      ...(org.approvedAt ? { approvedAt: org.approvedAt } : {}),
    };
  });
};
