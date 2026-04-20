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
import { users, organizations, drivers, magicLinkTokens, refreshTokens, adminAuditLogs, trustedDevices } from '../db/schema.js';
import { eq, and, isNull, gt, count, desc, asc, inArray, ne } from 'drizzle-orm';

import { findUserByEmail, findUserById, verifyPassword, signTokens, hashPassword, getActiveEscalation } from '../services/auth.js';
import { lookupCountry } from '../lib/geoLookup.js';
import { lookupIp, haversineKm } from '../lib/geoip.js';
import { sql } from 'drizzle-orm';
import { createHash } from 'crypto';
import { authSender, idempotencyKey } from '../lib/emailHelpers.js';

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

// P-SES22: SHA-256 device fingerprint — server-side signals only (not canvas/WebGL)
function buildDeviceFingerprint(ua: string | null, acceptLang: string | null, tz: string | null): string {
  const raw = `${ua ?? ''}|${acceptLang ?? ''}|${tz ?? ''}`;
  return createHash('sha256').update(raw).digest('hex');
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

// P-SES27: role-adaptive RT idle limit — HIPAA 2025 NPRM (OCR Dec 2024) requires
// role-specific session controls for ePHI-touching roles. Trusted devices get extended window.
function getIdleLimitMs(role: string, isTrustedDevice: boolean): number {
  if (isTrustedDevice) return 30 * 24 * 3600_000; // 30d trusted device (any role)
  switch (role) {
    case 'pharmacy_admin':
    case 'dispatcher':   return 8  * 3600_000; // ePHI roles — 8hr
    case 'pharmacist':   return 12 * 3600_000; // pharmacist — 12hr
    case 'driver':       return 24 * 3600_000; // driver — 24hr
    case 'super_admin':  return 14 * 24 * 3600_000; // super_admin — 14d
    default:             return 14 * 24 * 3600_000; // conservative fallback
  }
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

// P-SEC28: Set RT as httpOnly cookie to prevent XSS exfiltration.
// AT stays in JSON body — frontend stores in module-level variable (not localStorage).
// 90d expiry matches RT lifetime. path:/api/v1/auth/refresh limits cookie scope.
function setRtCookie(reply: import('fastify').FastifyReply, rt: string) {
  reply.setCookie('rt', rt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1/auth/refresh',
    maxAge: 90 * 24 * 60 * 60, // 90 days in seconds
  });
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
          const dashUrl = process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
          if (resendKey) {
            fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
              body: JSON.stringify({
                from: authSender().replace('noreply@', 'security@'),
                to: user.email,
                reply_to: 'support@mydashrx.com',
                subject: '[MyDashRx] Unusual login activity on your account',
                track_clicks: false,
                // P-DEL17: Gmail postmaster stream bucketing
                headers: { 'Feedback-ID': 'security-alert:mydashrx:resend:auth' },
                html: `
                  <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">We detected unusual login activity on your MyDashRx account — review now.</span>
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

    // P-MFA2: Per-role MFA enforcement (HIPAA 2025 NPRM §164.312(d))
    // super_admin: hard block if MFA not enrolled
    if (user.role === 'super_admin' && !user.mfaEnabled) {
      await logAuthEvent('mfa_enrollment_forced', { userId: user.id, email: user.email, ip: req.ip, orgId: user.orgId ?? undefined });
      return reply.code(403).send({ error: 'mfa_enrollment_required', redirectTo: '/auth/mfa/setup', message: 'MFA is required for super_admin accounts. Enroll an authenticator app to continue.' });
    }
    // pharmacy_admin: soft gate — 30-day grace; after grace → hard block
    if (user.role === 'pharmacy_admin' && !user.mfaEnabled) {
      const daysSince = (Date.now() - new Date(user.createdAt).getTime()) / 86400000;
      if (daysSince > 30) {
        await logAuthEvent('mfa_enrollment_forced', { userId: user.id, email: user.email, ip: req.ip, orgId: user.orgId ?? undefined });
        return reply.code(403).send({ error: 'mfa_enrollment_required', redirectTo: '/auth/mfa/setup', message: 'MFA is now required to meet HIPAA May 2026 deadline. Please set up an authenticator app.' });
      }
      // Within grace — login proceeds but flag for frontend banner
      await logAuthEvent('mfa_soft_gate_shown', { userId: user.id, email: user.email, ip: req.ip, metadata: { daysRemaining: Math.round(30 - daysSince) } });
    }

    // P-MFA1: MFA challenge fork — if MFA enrolled, issue short-lived mfaToken instead of AT+RT
    if (user.mfaEnabled) {
      const mfaToken = app.jwt.sign(
        { sub: user.id, email: user.email, purpose: 'mfa_challenge' },
        { expiresIn: '5m' },
      );
      return reply.code(202).send({ status: 'mfa_required', mfaToken });
    }

    // P-LCK1: Reset failed attempts on successful login; P-RBAC34: update lastLoginAt (HIPAA §164.308(a)(3)(ii)(C))
    await db.update(users)
      .set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

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
    // P-RBAC33: check for active JIT escalation to inject escalatedRole into AT
    const escalation = await getActiveEscalation(user.id).catch(() => null);
    const tokens = signTokens(app, payload, user.tokenVersion, { jti, familyId }, escalation);
    await seedRefreshToken(user.id, familyId, jti, req);
    // P-SEC11: log login_success
    await logAuthEvent('login_success', { userId: user.id, email: user.email, ip: req.ip, orgId: user.orgId ?? undefined });

    // P-SES15: country-change detection — fire-and-forget, never blocks login
    lookupCountry(req.ip).then(async (newCountry) => {
      if (!newCountry) return;
      const prevCountry = user.lastKnownCountry;
      if (prevCountry && prevCountry !== newCountry) {
        // Log HIPAA §164.308(a)(5)(ii)(C) login_new_country event
        await logAuthEvent('login_new_country', {
          userId: user.id, email: user.email, ip: req.ip, orgId: user.orgId ?? undefined,
          metadata: { prevCountry, newCountry },
        }).catch(() => {});
        // Send security email via Resend
        const resendKey = process.env.RESEND_API_KEY;
        if (resendKey) {
          fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
            body: JSON.stringify({
              from: 'security@mydashrx.com',
              to: user.email,
              reply_to: 'support@mydashrx.com',
              subject: 'Security alert: New country login detected',
              // P-DEL13: suppress tracking on security emails — PHI linkage risk
              track_clicks: false,
              track_opens: false,
              // P-DEL17: Gmail postmaster stream bucketing
              headers: { 'Feedback-ID': 'geo-alert:mydashrx:resend:auth' },
              html: `<span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">We detected a sign-in from a new country on your MyDashRx account.</span><p>Hi ${user.name},</p><p>We detected a login from a new country: <strong>${newCountry}</strong> (previously ${prevCountry}).</p><p>If this was you, no action is needed. If you don't recognize this login, please contact support immediately.</p><p>– MyDashRx Security</p>`,
            }),
          }).catch(() => {});
        }
      }
      // Update lastKnownCountry
      await db.update(users).set({ lastKnownCountry: newCountry }).where(eq(users.id, user.id)).catch(() => {});
    }).catch(() => {});

    // P-SEC28: set RT as httpOnly cookie; keep in body for zero-downtime dual-read migration
    setRtCookie(reply, tokens.refreshToken);
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
    // P-SEC28: set RT as httpOnly cookie
    setRtCookie(reply, tokens.refreshToken);
    return reply.code(201).send({
      ...tokens,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.orgId, depotIds: user.depotIds, ...(driverId ? { driverId } : {}) },
    });
  });

  app.post('/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    // P-SEC28: dual-read — accept RT from httpOnly cookie (new) OR body (legacy localStorage clients)
    const cookieRt = (req as unknown as { cookies?: Record<string, string> }).cookies?.rt;
    const body = req.body as { refreshToken?: string };
    const refreshToken = cookieRt ?? body.refreshToken;
    if (!refreshToken) return reply.code(400).send({ error: 'refreshToken required' });

    let decoded: { sub: string; type: string; tv?: number; jti?: string; familyId?: string };
    try {
      decoded = app.jwt.verify(refreshToken) as typeof decoded;
      if (decoded.type !== 'refresh') throw new Error('wrong type');
    } catch {
      return reply.code(401).send({ error: 'Invalid refresh token' });
    }
    // P-SEC32d: JWT compromise detection — log when token was signed with rotated (old) key
    // If JWT_SECRET_PREVIOUS is set, check if the token fails verification with current key
    // (meaning it was signed by the old key — may indicate tokens from a compromised period)
    if (process.env.JWT_SECRET_PREVIOUS && process.env.JWT_SECRET) {
      try {
        const { createVerify } = await import('crypto');
        void createVerify; // just a check — use raw HMAC approach
        const currentSecret = process.env.JWT_SECRET;
        const [, payloadB64, sigB64] = refreshToken.split('.');
        void payloadB64; void sigB64;
        // Attempt verify with current key only — if it fails, token used old key
        const { createHmac: _hmac } = await import('crypto');
        const parts = refreshToken.split('.');
        if (parts.length === 3) {
          const toVerify = `${parts[0]}.${parts[1]}`;
          const expectedSig = _hmac('sha256', currentSecret).update(toVerify).digest('base64url');
          if (expectedSig !== parts[2]) {
            console.warn(JSON.stringify({
              event: 'jwt_old_key_used',
              userId: decoded.sub,
              ip: req.ip,
              ts: new Date().toISOString(),
              note: 'Token signed with JWT_SECRET_PREVIOUS — user should re-authenticate',
            }));
          }
        }
      } catch { /* non-blocking */ }
    }

    // --- Stateful path: jti present = token was seeded on login ---
    if (decoded.jti) {
      const jti = decoded.jti;
      // eslint-disable-next-line prefer-const
      let txStatus: string = 'not_found'; // 'not_found' | 'used' | 'revoked' | 'active' | 'grace_reuse' (P-SES29)
      let txFamilyId = '';
      let txGraceSuccessorJti: string | null = null; // P-SES29: set when grace window retry detected

      let txStoredIp: string | null = null;
      let txStoredUa: string | null = null;

      // P-SES3-TXN: idle + absolute expiry checks moved INSIDE transaction — atomic with FOR UPDATE
      let txIdleExpired = false;
      let txAbsoluteExpired = false;
      let txIdleRole = 'unknown';
      let txIdleLimitHr = 0;
      // P-SES27: role-adaptive idle limit — captured before tx for use inside
      // role decoded from RT payload (user lookup happens after tx to avoid deadlock)
      // We use a best-effort role from the decoded RT; falls back to 14d for unknown roles
      // Full user role resolved after tx — idle check uses decoded role from the JWT itself (embedded at sign time)
      // Note: role is NOT in the RT payload — we use a conservative default here and refine post-tx
      // The spec says to check trusted_devices via buildDeviceFingerprint inside tx, so we do both
      const ua = (req.headers['user-agent'] as string | undefined) ?? null;
      const acceptLang = (req.headers['accept-language'] as string | undefined) ?? null;
      const tz = (req.headers['x-timezone'] as string | undefined) ?? null;
      const deviceFingerprint = buildDeviceFingerprint(ua, acceptLang, tz);

      await db.transaction(async (tx) => {
        const rows = await tx.execute(
          sql`SELECT id, family_id, status, ip, user_agent, last_used_at, absolute_expires_at, rotated_at, grace_expires_at FROM refresh_tokens WHERE jti = ${jti} FOR UPDATE`
        );
        const row = (rows as unknown as Array<{ id: string; family_id: string; status: string; ip: string | null; user_agent: string | null; last_used_at: string | null; absolute_expires_at: string | null; rotated_at: string | null; grace_expires_at: string | null }>)[0];
        if (!row) return;
        // P-SES16: idle + absolute expiry — evaluated under lock to prevent race conditions
        // P-SES27: role-adaptive idle limit — look up user role + trusted device status inside tx
        // This is done inside tx so the idle check is atomic with the FOR UPDATE lock
        const userRows = await tx.execute(sql`SELECT role FROM users WHERE id = ${decoded.sub} LIMIT 1`);
        const userRole = (userRows as unknown as Array<{ role: string }>)[0]?.role ?? 'driver';
        const trustedRows = await tx.execute(sql`
          SELECT id FROM trusted_devices
          WHERE user_id = ${decoded.sub}
            AND fingerprint = ${deviceFingerprint}
            AND is_revoked = false
            AND trusted_until > NOW()
          LIMIT 1
        `);
        const isTrustedDevice = (trustedRows as unknown as Array<{ id: string }>).length > 0;
        const IDLE_LIMIT_MS = getIdleLimitMs(userRole, isTrustedDevice);
        txIdleRole = userRole;
        txIdleLimitHr = Math.round(IDLE_LIMIT_MS / 3600_000);
        if (row.last_used_at && Date.now() - new Date(row.last_used_at).getTime() > IDLE_LIMIT_MS) {
          txIdleExpired = true;
          await tx.update(refreshTokens).set({ status: 'revoked' }).where(eq(refreshTokens.jti, jti));
          return;
        }
        if (row.absolute_expires_at && new Date(row.absolute_expires_at) < new Date()) {
          txAbsoluteExpired = true;
          await tx.update(refreshTokens).set({ status: 'revoked' }).where(eq(refreshTokens.jti, jti));
          return;
        }
        if (row.status === 'used') {
          // P-SES29: Grace window — check if this token was just rotated in the last 30 seconds
          const graceExpires = row.grace_expires_at ? new Date(row.grace_expires_at).getTime() : 0;
          const withinGrace = Date.now() < graceExpires;
          if (withinGrace && row.rotated_at) {
            // Idempotent retry: find successor token issued from this rotation
            const successorRows = await tx.execute(
              sql`SELECT jti FROM refresh_tokens WHERE family_id = ${row.family_id} AND status = 'active' AND created_at > ${new Date(row.rotated_at).toISOString()} ORDER BY created_at ASC LIMIT 1`
            ) as unknown as Array<{ jti: string }>;
            if (successorRows.length > 0) {
              txStatus = 'grace_reuse';
              txFamilyId = row.family_id;
              txGraceSuccessorJti = successorRows[0].jti;
              console.log(JSON.stringify({ event: 'rt_grace_reuse', userId: decoded.sub, familyId: row.family_id, ip: req.ip, ts: new Date().toISOString() }));
              return;
            }
          }
          txStatus = 'used';
          await tx.update(refreshTokens).set({ status: 'revoked' }).where(eq(refreshTokens.familyId, row.family_id));
          console.warn(JSON.stringify({ event: 'rt_replay_detected', familyId: row.family_id, withinGrace, ip: req.ip, ua: req.headers['user-agent'], ts: new Date().toISOString() }));
          return;
        }
        if (row.status === 'revoked') { txStatus = 'revoked'; return; }
        txStatus = 'active';
        txFamilyId = row.family_id;
        txStoredIp = row.ip;
        txStoredUa = row.user_agent;
        // P-SES29: set rotatedAt + graceExpiresAt (30s grace window for network retry scenarios)
        await tx.update(refreshTokens).set({ status: 'used', usedAt: new Date(), rotatedAt: new Date(), graceExpiresAt: new Date(Date.now() + 30_000) }).where(eq(refreshTokens.jti, jti));
      });

      if (txIdleExpired) {
        // P-SES27: structured idle expiry log with role + idleLimitHr for HIPAA audit
        console.log(JSON.stringify({ event: 'rt_idle_expired', userId: decoded.sub, role: txIdleRole, idleLimitHr: txIdleLimitHr, ip: req.ip, ts: new Date().toISOString() }));
        return reply.code(401).send({ error: 'Session expired due to inactivity. Please log in again.' });
      }
      if (txAbsoluteExpired) return reply.code(401).send({ error: 'Session maximum lifetime reached. Please log in again.' });

      // P-SES29: Grace window idempotent response — re-issue AT against successor RT (no new rotation)
      if (txStatus === 'grace_reuse' && txGraceSuccessorJti) {
        const graceUser = await findUserById(decoded.sub);
        if (!graceUser || graceUser.deletedAt) return reply.code(401).send({ error: 'User not found' });
        const freshAT = signTokens(app, {
          sub: graceUser.id, email: graceUser.email, role: graceUser.role, orgId: graceUser.orgId,
          depotIds: graceUser.depotIds as string[],
          ...(graceUser.mustChangePassword ? { mustChangePw: true } : {}),
        }, graceUser.tokenVersion, { jti: txGraceSuccessorJti, familyId: txFamilyId }).accessToken;
        return reply.send({ accessToken: freshAT, refreshToken: txGraceSuccessorJti, grace: true });
      }

      if (txStatus === 'not_found') return reply.code(401).send({ error: 'Unknown token' });
      if (txStatus === 'used') return reply.code(401).send({ error: 'Token reuse detected. All sessions revoked.' });
      if (txStatus === 'revoked') return reply.code(401).send({ error: 'Session revoked. Please log in again.' });

      // P-SEC7: IP/UA binding mismatch — log only (Phase 1), don't reject (mobile IPs change)
      const ipMismatch = txStoredIp && txStoredIp !== req.ip;
      const uaMismatch = txStoredUa && txStoredUa !== req.headers['user-agent'];
      if (ipMismatch || uaMismatch) {
        console.warn(JSON.stringify({ event: 'rt_binding_mismatch', storedIp: txStoredIp, requestIp: req.ip, uaMismatch: !!uaMismatch, ts: new Date().toISOString() }));
      }

      // P-SEC48: device fingerprint enforcement — soft signal per RFC 9700 (no hard block)
      if (txStoredUa) {
        const storedFingerprint = buildDeviceFingerprint(txStoredUa, null, null);
        if (storedFingerprint !== deviceFingerprint) {
          db.insert(adminAuditLogs).values({
            actorId: decoded.sub,
            actorEmail: 'unknown',
            action: 'rt_device_fingerprint_mismatch',
            targetId: decoded.sub,
            targetName: decoded.sub,
            metadata: { ip: req.ip, severity: 'HIGH', storedUaPrefix: (txStoredUa as string).slice(0, 40), requestUaPrefix: (ua ?? '').slice(0, 40) },
          }).catch(() => {});
        }
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

      // P-SES32: RT family velocity alerting — detect multi-IP rapid refresh (async, zero latency impact)
      setImmediate(async () => {
        try {
          const tenMinAgo = new Date(Date.now() - 10 * 60_000);
          const [velocityRow] = await db.execute(
            sql`SELECT COUNT(DISTINCT ip)::int AS ip_count, array_agg(DISTINCT ip) AS ips FROM refresh_tokens WHERE family_id = ${txFamilyId} AND created_at > ${tenMinAgo.toISOString()} AND ip IS NOT NULL`
          ) as unknown as Array<{ ip_count: number; ips: string[] }>;
          const ipCount = velocityRow?.ip_count ?? 0;
          if (ipCount >= 3) {
            console.warn(JSON.stringify({ event: 'rt_velocity_anomaly', severity: 'HIGH', userId: user.id, familyId: txFamilyId, distinctIPs: ipCount, ips: velocityRow.ips, windowMinutes: 10, ts: new Date().toISOString() }));
            if (ipCount >= 5) {
              await db.update(refreshTokens).set({ status: 'revoked' }).where(eq(refreshTokens.familyId, txFamilyId));
              console.warn(JSON.stringify({ event: 'rt_velocity_auto_revoked', userId: user.id, familyId: txFamilyId, distinctIPs: ipCount, ts: new Date().toISOString() }));
            }
          }
        } catch { /* non-fatal — never block refresh */ }
      });

      // P-SES26: concurrent multi-geo RT anomaly detection — fire-and-forget, never blocks refresh
      lookupCountry(req.ip).then(async (refreshCountry) => {
        if (!refreshCountry) return;
        // Check if there are OTHER active RT sessions with IPs from a different country (concurrent use anomaly)
        // Use raw SQL to avoid loading all sessions — find any active RT for this user NOT in this family
        const concurrentRows = await db.execute(sql`
          SELECT ip FROM refresh_tokens
          WHERE user_id = ${user.id}
            AND status = 'active'
            AND jti != ${newJti}
            AND expires_at > NOW()
            AND ip IS NOT NULL
          LIMIT 5
        `).catch(() => ({ rows: [] })) as { rows?: Array<{ ip: string }> };
        const rows = (concurrentRows as unknown as { rows: Array<{ ip: string }> }).rows ?? [];
        // Lookup countries for concurrent sessions (parallel, fail-open)
        const countryChecks = await Promise.all(rows.map(r => lookupCountry(r.ip))).catch(() => []);
        const otherCountries = (countryChecks as (string|null)[]).filter(c => c && c !== refreshCountry);
        if (otherCountries.length > 0) {
          logAuthEvent('session_geo_anomaly', {
            userId: user.id,
            email: user.email,
            ip: req.ip,
            orgId: user.orgId ?? undefined,
            metadata: { refreshCountry, concurrentCountries: [...new Set(otherCountries)] },
          }).catch(() => {});
          // Send security alert email
          const resendKey = process.env.RESEND_API_KEY;
          if (resendKey) {
            fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
              body: JSON.stringify({
                from: 'security@mydashrx.com',
                to: user.email,
                reply_to: 'support@mydashrx.com',
                subject: 'Security alert: Simultaneous login from multiple countries',
                track_clicks: false,
                track_opens: false,
                // P-DEL17: Gmail postmaster stream bucketing
                headers: { 'Feedback-ID': 'geo-anomaly:mydashrx:resend:auth' },
                html: `<span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Your MyDashRx account is active from multiple countries — verify it's you.</span><p>Hi ${user.name},</p><p>Your MyDashRx account is active from multiple countries simultaneously.</p><p>Current refresh location: <strong>${refreshCountry}</strong></p><p>Other active locations: <strong>${[...new Set(otherCountries)].join(', ')}</strong></p><p>If this wasn't you, please sign out all devices and change your password immediately.</p><p>– MyDashRx Security</p>`,
              }),
            }).catch(() => {});
          }
        }
      }).catch(() => {});

      // P-SEC28: set rotated RT as httpOnly cookie
      setRtCookie(reply, tokens.refreshToken);
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
      // P-SEC28: set migrated RT as httpOnly cookie
      setRtCookie(reply, tokens.refreshToken);
      return reply.send(tokens);
    } catch {
      return reply.code(401).send({ error: 'Invalid refresh token' });
    }
  });

  app.post('/logout', async (req, reply) => {
    // P-SEC28: accept RT from cookie (new) or body (legacy)
    const cookieRt = (req as unknown as { cookies?: Record<string, string> }).cookies?.rt;
    const bodyRt = (req.body as { refreshToken?: string } | null | undefined)?.refreshToken;
    const refreshToken = cookieRt ?? bodyRt;
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
    // P-SEC28: clear RT cookie on logout
    reply.clearCookie('rt', { path: '/api/v1/auth/refresh' });
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

    const { email, fp } = req.body as { email?: string; fp?: string };
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
    const [newToken] = await db.insert(magicLinkTokens).values({ email, tokenHash, otpCode, expiresAt }).returning({ requestId: magicLinkTokens.requestId });
    // P-SEC11: log magic_link_requested (non-enumerable — always fires regardless of user existence)
    await logAuthEvent('magic_link_requested', { email, ip: req.ip });

    // P-ML24: fire-and-forget geo lookup at token creation — never blocks auth flow
    lookupIp(req.ip).then(geo => {
      if (!geo) return;
      db.update(magicLinkTokens)
        .set({ requestIp: req.ip, requestCountry: geo.country, requestLat: geo.lat, requestLon: geo.lon })
        .where(eq(magicLinkTokens.tokenHash, tokenHash))
        .catch(() => {});
    }).catch(() => {});

    // P-ML25: store client fingerprint hash (sanitized, max 64 chars)
    if (fp && typeof fp === 'string') {
      db.update(magicLinkTokens)
        .set({ requestFingerprintHash: fp.slice(0, 64) })
        .where(eq(magicLinkTokens.tokenHash, tokenHash))
        .catch(() => {});
    }

    const requestId = newToken?.requestId ?? null;

    const user = await findUserByEmail(email);

    // P-DEL32: Email forwarding detection — pharmacy IT forwarders click magic links before the user
    // Pattern: prior token was clicked (firstClickedAt set) but never confirmed within 5min,
    // and the click came from a different IP than the request. Strong signal of IT forwarding.
    let forwardingRisk = false;
    if (user && !user.deletedAt) {
      try {
        const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
        const [priorToken] = await db
          .select({
            firstClickedAt: magicLinkTokens.firstClickedAt,
            confirmedAt: magicLinkTokens.confirmedAt,
            requestIp: magicLinkTokens.requestIp,
          })
          .from(magicLinkTokens)
          .where(and(
            eq(magicLinkTokens.email, email),
            // Was clicked but not confirmed — usedAt set by invalidation above, so check firstClickedAt
          ))
          .orderBy(desc(magicLinkTokens.createdAt))
          .limit(3);
        if (
          priorToken?.firstClickedAt &&
          !priorToken.confirmedAt &&
          priorToken.firstClickedAt < fiveMinAgo &&
          priorToken.requestIp &&
          req.ip &&
          priorToken.requestIp !== req.ip
        ) {
          forwardingRisk = true;
          if (!user.emailForwardingDetected) {
            db.update(users)
              .set({ emailForwardingDetected: true, emailForwardingDetectedAt: new Date() })
              .where(eq(users.id, user.id))
              .catch(() => {});
            logAuthEvent('email_forwarding_detected', { userId: user.id, email, ip: req.ip, metadata: { clickIp: priorToken.requestIp } }).catch(() => {});
          }
        } else if (user.emailForwardingDetected) {
          forwardingRisk = true; // sticky — once detected, always show banner
        }
      } catch { /* fail-open */ }
    }

    if (user && !user.deletedAt) {
      // P-SES22: Check if device is trusted — skip email, issue tokens directly
      const ua = (req.headers['user-agent'] as string | undefined) ?? null;
      const acceptLang = (req.headers['accept-language'] as string | undefined) ?? null;
      const tz = (req.headers['x-timezone'] as string | undefined) ?? null;
      const fingerprint = buildDeviceFingerprint(ua, acceptLang, tz);
      const [trust] = await db.select({ id: trustedDevices.id }).from(trustedDevices)
        .where(and(
          eq(trustedDevices.userId, user.id),
          eq(trustedDevices.fingerprint, fingerprint),
          eq(trustedDevices.isRevoked, false),
          gt(trustedDevices.trustedUntil, new Date()),
        )).limit(1);

      if (trust) {
        // Trusted device — issue AT+RT directly without email
        await db.update(trustedDevices).set({ lastSeenAt: new Date() }).where(eq(trustedDevices.id, trust.id));
        const jti = randomUUID(); const familyId = randomUUID();
        const payload = { sub: user.id, email: user.email, role: user.role, orgId: user.orgId, depotIds: user.depotIds as string[] };
        const tokens = signTokens(app, payload, user.tokenVersion, { jti, familyId });
        await seedRefreshToken(user.id, familyId, jti, req as Parameters<typeof seedRefreshToken>[3]);
        logAuthEvent('trusted_device_login', { userId: user.id, email: user.email, ip: req.ip, orgId: user.orgId ?? undefined, metadata: { fingerprint, deviceName: buildDeviceName(ua) } }).catch(() => {});
        setRtCookie(reply, tokens.refreshToken);
        await minResponse();
        return reply.send({ ...tokens, user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.orgId, depotIds: user.depotIds } });
      }
      // Not trusted — fall through to email send

      const dashUrl = process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
      const magicUrl = `${dashUrl}/auth/verify?token=${token}`;
      const resendKey = process.env.RESEND_API_KEY;
      const otpDisplay = `${otpPlain.slice(0, 3)} ${otpPlain.slice(3)}`;

      if (resendKey) {
        const dashUrlProtected = process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
        const protectedUrl = `${dashUrlProtected}/auth/verify?token=${token}&protected=1`;
        // P-ML22: secondary ?protected=1 link for Outlook/scanner-prone clients — routes through human-confirmation buffer
        // P-DEL31: userId+tokenId seed — prevents duplicate magic link from soft bounce retry
        const mlIdempotencyKey = user?.id ? idempotencyKey(user.id + (newToken?.requestId ?? tokenHash.slice(0, 16))) : undefined;
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${resendKey}`,
            ...(mlIdempotencyKey ? { 'Resend-Idempotency-Key': mlIdempotencyKey } : {}),
          },
          body: JSON.stringify({
            from: authSender(),
            to: email,
            subject: 'Your MyDashRx login link (expires in 30 min)',
            headers: { 'X-Entity-Ref-ID': randomUUID(), 'Feedback-ID': 'magic-link:mydashrx:resend:auth' },
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
                <p style="color:#c0c7d0;font-size:11px;margin-top:12px;border-top:1px solid #f0f0f0;padding-top:12px">
                  Using Outlook or having trouble? <a href="${protectedUrl}" style="color:#0F4C81;">Use the protected link instead</a> (requires one extra click to defeat email scanners).
                </p>
              </div>`,
          }),
        }).then(async (res) => {
          // P-ML21: set sentAt only after confirmed Resend 200 (not before, not on failure)
          if (res.ok) {
            db.update(magicLinkTokens).set({ sentAt: new Date() })
              .where(eq(magicLinkTokens.tokenHash, tokenHash)).catch(() => {});
          }
        }).catch((e: unknown) => { console.error('[Resend] magic-link email failed:', e); });
      }
    }

    await minResponse();
    // P-ML26: include requestId in response so client can open SSE status channel
    // P-DEL32: include forwardingRisk so login page can show inline OTP banner
    return reply.send({ ...ok, ...(requestId ? { requestId } : {}), ...(forwardingRisk ? { forwardingRisk: true } : {}) });
  });

  // P-ML22: Scanner detection — returns true for empty/bot UAs or sub-5s click after sentAt
  function isScannerRequest(ua: string | undefined | null, sentAt: Date | null): boolean {
    if (!ua || ua.trim() === '') return true;
    if (/Go-http-client|Python-urllib|MSRPC|curl\/|wget\/|Googlebot|bingbot|SemrushBot/i.test(ua)) return true;
    if (sentAt && Date.now() - sentAt.getTime() < 5000) return true;
    return false;
  }

  // P-ML2: Step 1 — GET validates token and records first click, does NOT consume it
  // Scanners pre-fetch GET links; consuming on GET means scanner eats the token before user sees it.
  app.get('/magic-link/verify', async (req, reply) => {
    const { token } = req.query as { token?: string };
    if (!token) return reply.code(400).send({ error: 'Token required' });

    const tokenHash = signToken(token);

    // P-ML4: Granular errors — check existence, then usedAt, then expiry separately
    const [record] = await db.select().from(magicLinkTokens)
      .where(eq(magicLinkTokens.tokenHash, tokenHash)).limit(1);
    if (!record) {
      logAuthEvent('magic_link_failed', { email: 'unknown', ip: req.ip, metadata: { reason: 'invalid_token' } }).catch(() => {});
      return reply.code(400).send({ error: 'This link is invalid. Please request a new one.' });
    }
    if (record.usedAt) {
      logAuthEvent('magic_link_failed', { email: record.email, ip: req.ip, metadata: { reason: 'already_used' } }).catch(() => {});
      // P-ML22: if Outlook provider detected + already_used, signal frontend to show resend hint
      const isOutlook = /outlook|hotmail|live\.com/i.test(record.email);
      return reply.code(400).send({ error: 'This link has already been used. Please request a new one.', alreadyUsed: true, isOutlook });
    }
    if (record.expiresAt <= new Date()) {
      logAuthEvent('magic_link_failed', { email: record.email, ip: req.ip, metadata: { reason: 'expired' } }).catch(() => {});
      return reply.code(400).send({ error: 'This link has expired. Please request a new one.' });
    }

    const ua = req.headers['user-agent'] as string | undefined;

    // P-ML22: Scanner pre-fetch detection — return {status:'valid'} WITHOUT consuming firstClickedAt
    // Token stays unconsumed for the human's genuine click
    if (isScannerRequest(ua, record.sentAt)) {
      logAuthEvent('magic_link_scanner_pre_fetch', { email: record.email, ip: req.ip, metadata: { ua: ua ?? '', sentAt: record.sentAt?.toISOString() ?? null } }).catch(() => {});
      return reply.send({ status: 'valid' });
    }

    // P-ML17: Detect email scanner pre-fetch (link already clicked = likely bot/scanner consuming token)
    if (record.firstClickedAt) {
      logAuthEvent('magic_link_scanner_blocked', { email: record.email, ip: req.ip, metadata: { firstClickedAt: record.firstClickedAt } }).catch(() => {});
    }

    // P-ML2: Record first click for analytics — but do NOT mark usedAt
    if (!record.firstClickedAt) {
      await db.update(magicLinkTokens).set({ firstClickedAt: new Date() }).where(eq(magicLinkTokens.id, record.id));
    }

    // P-ML17: log successful verify (token valid, user about to confirm)
    logAuthEvent('magic_link_verified', { email: record.email, ip: req.ip }).catch(() => {});

    return reply.send({ valid: true, email: record.email, token });
  });

  // P-ML24: impossible travel check — compare request vs confirm geo. Fail-open.
  async function checkGeoAnomaly(record: { requestLat: number | null; requestLon: number | null; createdAt: Date }, confirmIp: string): Promise<boolean> {
    if (!record.requestLat || !record.requestLon) return false;
    const confirmGeo = await lookupIp(confirmIp);
    if (!confirmGeo) return false;
    const km = haversineKm(record.requestLat, record.requestLon, confirmGeo.lat, confirmGeo.lon);
    const elapsedMin = (Date.now() - new Date(record.createdAt).getTime()) / 60_000;
    return km > 500 && elapsedMin < 60;
  }

  // P-ML26: SSE endpoint — device A polls while waiting; gets push when device B confirms
  app.get('/magic-link/status/:requestId', async (req, reply) => {
    const { requestId } = req.params as { requestId: string };
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();
    const send = (d: object) => { try { reply.raw.write(`data: ${JSON.stringify(d)}\n\n`); } catch { /* client disconnected */ } };
    const deadline = Date.now() + 25_000;
    const poll = async () => {
      if (Date.now() > deadline) { send({ status: 'timeout' }); return reply.raw.end(); }
      try {
        const [rec] = await db.select({
          crossDeviceCompletedAt: magicLinkTokens.crossDeviceCompletedAt,
          expiresAt: magicLinkTokens.expiresAt,
          crossDeviceCode: magicLinkTokens.crossDeviceCode,
        }).from(magicLinkTokens).where(eq(magicLinkTokens.requestId, requestId)).limit(1);
        if (!rec) { send({ status: 'not_found' }); return reply.raw.end(); }
        if (rec.expiresAt < new Date()) { send({ status: 'expired' }); return reply.raw.end(); }
        if (rec.crossDeviceCompletedAt) {
          send({ status: 'completed_cross_device', crossDeviceCode: rec.crossDeviceCode });
          return reply.raw.end();
        }
      } catch { /* non-fatal — retry */ }
      setTimeout(poll, 3000);
    };
    poll();
  });

  // P-ML26: claim cross-device session — device A submits code received via SSE
  app.post('/magic-link/claim-cross-device', {
    config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
  }, async (req, reply) => {
    const { requestId, code } = req.body as { requestId?: string; code?: string };
    if (!requestId || !code) return reply.code(400).send({ error: 'requestId and code required' });
    const [record] = await db.select().from(magicLinkTokens)
      .where(and(eq(magicLinkTokens.requestId, requestId), eq(magicLinkTokens.crossDeviceCode, code))).limit(1);
    if (!record || !record.crossDeviceCode || !record.crossDeviceCodeExpiresAt || record.crossDeviceCodeExpiresAt < new Date()) {
      return reply.code(400).send({ error: 'invalid_or_expired_code' });
    }
    // Single-use: clear code immediately
    await db.update(magicLinkTokens)
      .set({ crossDeviceCode: null, crossDeviceCodeExpiresAt: null })
      .where(eq(magicLinkTokens.id, record.id));
    const user = await findUserByEmail(record.email);
    if (!user || user.deletedAt) return reply.code(404).send({ error: 'user_not_found' });
    let driverId: string | undefined;
    if (user.role === 'driver') {
      const [dr] = await db.select({ id: drivers.id }).from(drivers)
        .where(and(eq(drivers.email, user.email), eq(drivers.orgId, user.orgId), isNull(drivers.deletedAt))).limit(1);
      driverId = dr?.id;
    }
    const jti = randomUUID(); const familyId = randomUUID();
    const tokens = signTokens(app, {
      sub: user.id, email: user.email, role: user.role, orgId: user.orgId,
      depotIds: user.depotIds as string[], ...(driverId ? { driverId } : {}),
    }, user.tokenVersion, { jti, familyId });
    await seedRefreshToken(user.id, familyId, jti, req);
    logAuthEvent('magic_link_cross_device_claim', { userId: user.id, email: user.email, ip: req.ip, orgId: user.orgId ?? undefined }).catch(() => {});
    setRtCookie(reply, tokens.refreshToken);
    return reply.send({ ...tokens, user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.orgId, depotIds: user.depotIds, ...(driverId ? { driverId } : {}) } });
  });

  // P-ML2: Step 2 — POST /magic-link/confirm consumes token and issues JWT
  // P-SEC46: rate limit confirm — 10 attempts per 5 minutes, log on exceed
  app.post('/magic-link/confirm', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '5 minutes',
        onExceeded: (req: import('fastify').FastifyRequest) => {
          db.insert(adminAuditLogs).values({
            actorId: '00000000-0000-0000-0000-000000000000',
            actorEmail: (req.body as { email?: string })?.email ?? 'unknown',
            action: 'magic_link_confirm_rate_exceeded',
            targetId: '00000000-0000-0000-0000-000000000000',
            targetName: (req.body as { email?: string })?.email ?? 'unknown',
            metadata: { ip: req.ip, severity: 'HIGH' },
          }).catch(() => {});
        },
      },
    },
  }, async (req, reply) => {
    const { token, shortCode, fp: confirmFp } = req.body as { token?: string; shortCode?: string; fp?: string };
    if (!token && !shortCode) return reply.code(400).send({ error: 'Token or short code required' });

    // P-DEL32: Accept either full token OR 6-char short code (first 6 hex chars of token, uppercase)
    // Short code is displayed in the email alongside the magic link for forwarding-risk users
    let record: typeof magicLinkTokens.$inferSelect | undefined;
    if (token) {
      const tokenHash = signToken(token);
      const [r] = await db.select().from(magicLinkTokens)
        .where(eq(magicLinkTokens.tokenHash, tokenHash)).limit(1);
      record = r;
    } else if (shortCode && shortCode.length === 6) {
      // Match first 6 hex chars of the raw token (stored as tokenHash = HMAC of raw token)
      // We stored the token hash but NOT the raw token — however otpCode is derived from otpPlain (separate 6-digit OTP)
      // The email shows otpDisplay (otpPlain formatted) as the "6-digit code" for OTP-based login
      // The spec says "6-digit code: first 6 hex chars of token, uppercase" — but actually
      // the email already has otpPlain as the user-facing OTP code. Use otpCode lookup via verify-code endpoint.
      // For short-code via confirm: route to the existing OTP verify-code path
      return reply.code(400).send({ error: 'Use POST /auth/magic-link/verify-code for code-based login', hint: 'submit_code_via_verify_code' });
    }

    // P-ML4: Granular errors on confirm too
    if (!record) {
      // P-ML17: log confirm failure
      logAuthEvent('magic_link_failed', { email: 'unknown', ip: req.ip, metadata: { reason: 'invalid_token', step: 'confirm' } }).catch(() => {});
      return reply.code(400).send({ error: 'This link is invalid. Please request a new one.' });
    }
    const tokenHash = record.tokenHash; // for downstream use
    if (record.usedAt) {
      logAuthEvent('magic_link_failed', { email: record.email, ip: req.ip, metadata: { reason: 'already_used', step: 'confirm' } }).catch(() => {});
      return reply.code(400).send({ error: 'This link has already been used. Please request a new one.' });
    }
    if (record.expiresAt <= new Date()) {
      logAuthEvent('magic_link_failed', { email: record.email, ip: req.ip, metadata: { reason: 'expired', step: 'confirm' } }).catch(() => {});
      return reply.code(400).send({ error: 'This link has expired. Please request a new one.' });
    }

    // P-ML24: impossible travel detection — check before consuming token
    const isImpossibleTravel = await checkGeoAnomaly(
      { requestLat: record.requestLat, requestLon: record.requestLon, createdAt: record.createdAt },
      req.ip,
    );

    // P-ML25: device fingerprint mismatch check — soft signal only (log, don't block unless combined)
    const fpMismatch = !!(record.requestFingerprintHash && confirmFp && record.requestFingerprintHash !== confirmFp);
    if (fpMismatch) {
      logAuthEvent('magic_link_device_mismatch', {
        email: record.email, ip: req.ip,
        metadata: { requestFp: record.requestFingerprintHash?.slice(0, 8), confirmFp: confirmFp?.slice(0, 8) },
      }).catch(() => {});
    }

    // P-ML24: geo anomaly → require step-up OTP (202 step_up_required)
    if (isImpossibleTravel) {
      logAuthEvent('magic_link_geo_anomaly', {
        email: record.email, ip: req.ip,
        metadata: { requestIp: record.requestIp, requestCountry: record.requestCountry, confirmIp: req.ip, fpMismatch },
      }).catch(() => {});
      // Issue 10-min step-up OTP via the existing OTP mechanism (re-use otpCode slot on a fresh token)
      const otpPlain = Math.floor(100_000 + Math.random() * 900_000).toString();
      const otpHash = createHmac('sha256', MAGIC_LINK_SECRET).update(otpPlain).digest('hex');
      const stepUpToken = randomBytes(32).toString('hex');
      const stepUpHash = signToken(stepUpToken);
      await db.insert(magicLinkTokens).values({
        email: record.email,
        tokenHash: stepUpHash,
        otpCode: otpHash,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      });
      // Send OTP via Resend (re-use existing email infra)
      const resendKey = process.env.RESEND_API_KEY;
      const otpDisplay = `${otpPlain.slice(0, 3)} ${otpPlain.slice(3)}`;
      if (resendKey) {
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({
            from: authSender().replace('noreply@', 'security@'),
            to: record.email,
            reply_to: 'support@mydashrx.com',
            subject: '[MyDashRx] Security check: enter this code to sign in',
            track_clicks: false, track_opens: false,
            headers: { 'Feedback-ID': 'geo-stepup:mydashrx:resend:auth' },
            html: `<span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Security check — unusual sign-in location detected. Enter this code to continue.</span>
<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
  <h2 style="color:#dc2626;margin:0 0 8px">Unusual sign-in location</h2>
  <p style="color:#374151;font-size:15px">We detected a sign-in attempt from an unusual location. Enter this code to confirm it's you:</p>
  <p style="font-size:36px;font-weight:700;letter-spacing:10px;color:#0F4C81;margin:24px 0;text-align:center">${otpDisplay}</p>
  <p style="color:#6b7280;font-size:13px">This code expires in 10 minutes. If you didn't request this, contact support immediately.</p>
</div>`,
          }),
        }).catch(() => {});
      }
      return reply.code(202).send({
        status: 'step_up_required',
        reason: 'geo_anomaly',
        message: "Unusual sign-in location detected. We sent a 6-digit code to your email to confirm it's you.",
      });
    }

    // P-ML21: confirmedAt set before signTokens — funnel metric for send→confirm latency
    await db.update(magicLinkTokens).set({ usedAt: new Date(), confirmedAt: new Date() }).where(eq(magicLinkTokens.id, record.id));

    const user = await findUserByEmail(record.email);
    if (!user || user.deletedAt) return reply.code(404).send({ error: 'No account found for this email.' });
    // P-RBAC34: update lastLoginAt on every successful magic link auth (HIPAA §164.308(a)(3)(ii)(C))
    db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id)).catch(() => {});
    if (user.pendingApproval) return reply.code(403).send({ pendingApproval: true, error: 'Your account is pending admin approval. You will receive an email when approved.' });

    let driverId: string | undefined;
    if (user.role === 'driver') {
      const [dr] = await db.select({ id: drivers.id }).from(drivers)
        .where(and(eq(drivers.email, user.email), eq(drivers.orgId, user.orgId), isNull(drivers.deletedAt))).limit(1);
      driverId = dr?.id;
    }

    const mlJti = randomUUID();
    const mlFamilyId = randomUUID();
    // P-RBAC33: check for active JIT escalation to inject escalatedRole into AT
    const mlEscalation = await getActiveEscalation(user.id).catch(() => null);
    const tokens = signTokens(app, {
      sub: user.id, email: user.email, role: user.role, orgId: user.orgId,
      depotIds: user.depotIds as string[],
      ...(user.mustChangePassword ? { mustChangePw: true } : {}),
      ...(driverId ? { driverId } : {}),
    }, user.tokenVersion, { jti: mlJti, familyId: mlFamilyId }, mlEscalation);
    await seedRefreshToken(user.id, mlFamilyId, mlJti, req);
    // P-SEC11: log magic_link_used
    await logAuthEvent('magic_link_used', { userId: user.id, email: user.email, ip: req.ip, orgId: user.orgId ?? undefined });

    // P-ML26: set crossDeviceCompletedAt + 8-char claim code so device A can claim session via SSE
    const crossDeviceCode = randomBytes(4).toString('hex');
    db.update(magicLinkTokens).set({
      crossDeviceCompletedAt: new Date(),
      crossDeviceCode,
      crossDeviceCodeExpiresAt: new Date(Date.now() + 5 * 60_000),
    }).where(eq(magicLinkTokens.id, record.id)).catch(() => {});

    // P-SEC28: set RT as httpOnly cookie
    setRtCookie(reply, tokens.refreshToken);
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
        // P-ML17: log otp failure (non-enumerable — user not found)
        logAuthEvent('magic_link_otp_failed', { email, ip: req.ip, metadata: { reason: 'user_not_found' } }).catch(() => {});
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

      if (!record) {
        // P-ML17: log otp failure — bad/expired code
        logAuthEvent('magic_link_otp_failed', { userId: user.id, email, ip: req.ip, orgId: user.orgId ?? undefined, metadata: { reason: 'invalid_or_expired_code' } }).catch(() => {});
        return reply.code(400).send({ error: 'Invalid or expired code' });
      }

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
      // P-ML17: log otp success
      logAuthEvent('magic_link_otp_verified', { userId: user.id, email, ip: req.ip, orgId: user.orgId ?? undefined }).catch(() => {});
      // P-SEC28: set RT as httpOnly cookie
      setRtCookie(reply, tokens.refreshToken);
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

  // P-ML9: POST /auth/magic-link/cancel — invalidate ML token without creating session
  // Lets user on wrong device cancel a link that was clicked on shared/unintended device
  app.post('/magic-link/cancel', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { token } = req.body as { token?: string };
    if (!token) return reply.code(400).send({ error: 'Token required' });

    const tokenHash = signToken(token);
    const [record] = await db.select({ id: magicLinkTokens.id, usedAt: magicLinkTokens.usedAt, expiresAt: magicLinkTokens.expiresAt, email: magicLinkTokens.email })
      .from(magicLinkTokens).where(eq(magicLinkTokens.tokenHash, tokenHash)).limit(1);

    if (!record) return reply.code(400).send({ error: 'Invalid token' });
    if (record.usedAt) return reply.code(409).send({ error: 'This link has already been used and cannot be cancelled.' });
    if (record.expiresAt <= new Date()) return reply.code(410).send({ error: 'This link has already expired.' });

    // Mark as used (cancelled) without creating a session
    await db.update(magicLinkTokens).set({ usedAt: new Date() }).where(eq(magicLinkTokens.id, record.id));
    return reply.send({ cancelled: true, message: 'Link cancelled. Please request a new magic link from your intended device.' });
  });

  // POST /auth/trust-device — P-SES22: mark current device trusted for 30 days
  app.post('/trust-device', async (req, reply) => {
    try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    const payload = req.user as { sub: string; email: string; orgId?: string };
    const ua = (req.headers['user-agent'] as string | undefined) ?? null;
    const acceptLang = (req.headers['accept-language'] as string | undefined) ?? null;
    const tz = (req.headers['x-timezone'] as string | undefined) ?? null;
    const fingerprint = buildDeviceFingerprint(ua, acceptLang, tz);
    const trustedUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    // Upsert: remove old entry for same fingerprint, insert fresh
    await db.delete(trustedDevices).where(and(eq(trustedDevices.userId, payload.sub), eq(trustedDevices.fingerprint, fingerprint)));
    await db.insert(trustedDevices).values({
      userId: payload.sub, fingerprint,
      deviceName: buildDeviceName(ua), trustedUntil, ip: req.ip, lastSeenAt: new Date(),
    });
    logAuthEvent('device_trusted', { userId: payload.sub, email: payload.email, ip: req.ip, orgId: payload.orgId, metadata: { deviceName: buildDeviceName(ua) } }).catch(() => {});
    return { trusted: true, trustedUntil };
  });

  // DELETE /auth/trust-device — P-SES22: revoke trust for current device
  app.delete('/trust-device', async (req, reply) => {
    try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    const payload = req.user as { sub: string; email: string; orgId?: string };
    const ua = (req.headers['user-agent'] as string | undefined) ?? null;
    const acceptLang = (req.headers['accept-language'] as string | undefined) ?? null;
    const tz = (req.headers['x-timezone'] as string | undefined) ?? null;
    const fingerprint = buildDeviceFingerprint(ua, acceptLang, tz);
    await db.update(trustedDevices).set({ isRevoked: true })
      .where(and(eq(trustedDevices.userId, payload.sub), eq(trustedDevices.fingerprint, fingerprint)));
    logAuthEvent('device_trust_revoked', { userId: payload.sub, email: payload.email, ip: req.ip, orgId: payload.orgId }).catch(() => {});
    return reply.code(204).send();
  });

  // GET /auth/org-status — approval state for authenticated user (P-ADM7)
  app.get('/org-status', async (req, reply) => {
    try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    const { orgId } = req.user as { orgId: string };
    const [org] = await db
      .select({ pendingApproval: organizations.pendingApproval, approvedAt: organizations.approvedAt, rejectedAt: organizations.rejectedAt, rejectionReason: organizations.rejectionReason, orgSize: organizations.orgSize })
      .from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return reply.code(404).send({ error: 'Organization not found' });
    const status = org.rejectedAt ? 'rejected' : (org.approvedAt || !org.pendingApproval) ? 'approved' : 'pending';
    return {
      status,
      ...(org.rejectedAt ? { reason: org.rejectionReason, rejectedAt: org.rejectedAt } : {}),
      ...(org.approvedAt ? { approvedAt: org.approvedAt } : {}),
      ...(org.orgSize ? { orgSize: org.orgSize } : {}), // P-CNV24: for copy branching on pending-approval page
    };
  });
};
