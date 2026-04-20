// P-MFA1: TOTP MFA — HIPAA 2025 NPRM mandatory ePHI authentication (§164.312(d))
// Routes registered at /auth/mfa/...
import type { FastifyPluginAsync } from 'fastify';
import { generateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';
import bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'crypto';
import { z } from 'zod';
import { db } from '../db/connection.js';
import { users, adminAuditLogs, refreshTokens } from '../db/schema.js';
import { eq, isNull } from 'drizzle-orm';
import { encryptPhi, decryptPhi } from '../lib/phiCrypto.js';
import { verifyPassword, signTokens } from '../services/auth.js';

// Verify TOTP with ±30s tolerance (epochTolerance = 30s)
function checkTotp(token: string, secret: string): boolean {
  try {
    const result = verifySync({ token, secret, epochTolerance: 30 });
    return result.valid;
  } catch { return false; }
}

async function logMfaEvent(
  actorId: string, actorEmail: string, action: string,
  metadata?: Record<string, unknown>,
) {
  await db.insert(adminAuditLogs).values({
    actorId, actorEmail, action, targetId: actorId, targetName: actorEmail,
    metadata: metadata ?? null,
  }).catch((e: unknown) => { console.error('[MFA Audit]', e); });
}

async function seedMfaRefreshToken(
  userId: string, familyId: string, jti: string,
  req: { ip: string; headers: Record<string, string | string[] | undefined> },
) {
  const now = new Date();
  const exp = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const ua = (req.headers['user-agent'] as string | undefined) ?? null;
  await db.insert(refreshTokens).values({
    jti, familyId, userId, ip: req.ip, userAgent: ua,
    lastUsedAt: now, absoluteExpiresAt: exp, expiresAt: exp,
  });
}

export const mfaRoutes: FastifyPluginAsync = async (app) => {

  // ── POST /auth/mfa/totp/setup ────────────────────────────────────────────
  // Authenticated. Generates TOTP secret + QR code. Does NOT enable MFA yet.
  app.post('/totp/setup', async (req, reply) => {
    try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    const { sub: userId, email } = req.user as { sub: string; email: string };

    const [user] = await db.select({ mfaEnabled: users.mfaEnabled })
      .from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return reply.code(404).send({ error: 'User not found' });
    if (user.mfaEnabled) return reply.code(409).send({ error: 'MFA already enabled. Disable first.' });

    const secret = generateSecret();
    const uri = generateURI({ issuer: 'MyDashRx', label: email, secret });
    const qrDataUrl = await QRCode.toDataURL(uri);

    // Store encrypted secret (pending verification)
    await db.update(users).set({ totpSecret: encryptPhi(secret) }).where(eq(users.id, userId));
    await logMfaEvent(userId, email, 'mfa_setup_initiated');

    return { qrDataUrl, secret, uri };
  });

  // ── POST /auth/mfa/totp/verify ───────────────────────────────────────────
  // Authenticated. Verifies first 6-digit code, enables MFA, returns backup codes.
  const verifySetupSchema = z.object({ code: z.string().length(6) });
  app.post('/totp/verify', async (req, reply) => {
    try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    const { sub: userId, email } = req.user as { sub: string; email: string };
    const parsed = verifySetupSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'code must be 6 digits' });

    const [user] = await db.select({ totpSecret: users.totpSecret, mfaEnabled: users.mfaEnabled })
      .from(users).where(eq(users.id, userId)).limit(1);
    if (!user?.totpSecret) return reply.code(400).send({ error: 'Run /setup first' });
    if (user.mfaEnabled) return reply.code(409).send({ error: 'MFA already enabled' });

    const secret = decryptPhi(user.totpSecret);
    if (!checkTotp(parsed.data.code, secret)) {
      await logMfaEvent(userId, email, 'mfa_setup_failed', { reason: 'invalid_code' });
      return reply.code(400).send({ error: 'Invalid TOTP code' });
    }

    const plainCodes = Array.from({ length: 8 }, () => randomBytes(5).toString('hex'));
    const hashedCodes = await Promise.all(plainCodes.map(c => bcrypt.hash(c, 10)));

    await db.update(users).set({
      mfaEnabled: true, totpEnabledAt: new Date(), totpBackupCodes: hashedCodes,
    }).where(eq(users.id, userId));

    await logMfaEvent(userId, email, 'mfa_totp_enabled');
    return { backupCodes: plainCodes, message: 'MFA enabled. Store backup codes securely — shown once only.' };
  });

  // ── POST /auth/mfa/totp/disable ──────────────────────────────────────────
  // Authenticated. Requires current TOTP code + password to disable MFA.
  const disableSchema = z.object({ code: z.string().length(6), password: z.string().min(1) });
  app.post('/totp/disable', async (req, reply) => {
    try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    const { sub: userId, email, role } = req.user as { sub: string; email: string; role: string };
    const parsed = disableSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'code and password required' });

    // P-MFA2: super_admin MFA is permanent
    if (role === 'super_admin') return reply.code(403).send({ error: 'super_admin MFA cannot be disabled' });

    const [user] = await db.select({
      totpSecret: users.totpSecret, mfaEnabled: users.mfaEnabled, passwordHash: users.passwordHash,
    }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user?.mfaEnabled) return reply.code(400).send({ error: 'MFA not enabled' });

    const pwOk = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!pwOk) return reply.code(401).send({ error: 'Invalid password' });

    const secret = decryptPhi(user.totpSecret!);
    if (!checkTotp(parsed.data.code, secret)) {
      await logMfaEvent(userId, email, 'mfa_disable_failed', { reason: 'invalid_code' });
      return reply.code(400).send({ error: 'Invalid TOTP code' });
    }

    await db.update(users).set({
      mfaEnabled: false, totpSecret: null, totpEnabledAt: null, totpBackupCodes: null,
    }).where(eq(users.id, userId));

    await logMfaEvent(userId, email, 'mfa_totp_disabled');
    return { message: 'MFA disabled' };
  });

  // ── POST /auth/mfa/totp/challenge ────────────────────────────────────────
  // No auth. Validates short-lived mfaToken + TOTP code → issues full AT+RT.
  const challengeSchema = z.object({ mfaToken: z.string(), code: z.string().length(6) });
  app.post('/totp/challenge', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const parsed = challengeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'mfaToken and 6-digit code required' });

    let mfaPayload: { sub: string; purpose: string; email: string } | null = null;
    try {
      mfaPayload = app.jwt.verify<{ sub: string; purpose: string; email: string }>(parsed.data.mfaToken);
    } catch {
      return reply.code(401).send({ error: 'Invalid or expired MFA token' });
    }
    if (mfaPayload.purpose !== 'mfa_challenge') return reply.code(401).send({ error: 'Invalid token purpose' });

    const [user] = await db.select({
      id: users.id, email: users.email, role: users.role, orgId: users.orgId,
      depotIds: users.depotIds, mustChangePassword: users.mustChangePassword,
      tokenVersion: users.tokenVersion, mfaEnabled: users.mfaEnabled,
      totpSecret: users.totpSecret, deletedAt: users.deletedAt,
    }).from(users).where(eq(users.id, mfaPayload.sub)).limit(1);

    if (!user || user.deletedAt) return reply.code(401).send({ error: 'User not found' });
    if (!user.mfaEnabled || !user.totpSecret) return reply.code(400).send({ error: 'MFA not configured' });

    const secret = decryptPhi(user.totpSecret);
    if (!checkTotp(parsed.data.code, secret)) {
      await logMfaEvent(user.id, user.email, 'mfa_challenge_failed', { ip: req.ip });
      return reply.code(401).send({ error: 'Invalid TOTP code' });
    }

    const jti = randomUUID();
    const familyId = randomUUID();
    const payload = {
      sub: user.id, email: user.email, role: user.role, orgId: user.orgId,
      depotIds: user.depotIds as string[], mfaVerified: true,
      ...(user.mustChangePassword ? { mustChangePw: true } : {}),
    };
    const tokens = signTokens(app, payload, user.tokenVersion, { jti, familyId });
    await seedMfaRefreshToken(user.id, familyId, jti, req);
    await logMfaEvent(user.id, user.email, 'mfa_challenge_passed', { ip: req.ip });

    reply.setCookie('rt', tokens.refreshToken, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict', path: '/api/v1/auth/refresh',
    });
    return { accessToken: tokens.accessToken };
  });

  // ── POST /auth/mfa/backup-code ───────────────────────────────────────────
  // No auth. Validates mfaToken + backup code → marks used → issues AT+RT.
  const backupSchema = z.object({ mfaToken: z.string(), backupCode: z.string().min(8) });
  app.post('/backup-code', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const parsed = backupSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'mfaToken and backupCode required' });

    let mfaPayload: { sub: string; purpose: string; email: string } | null = null;
    try {
      mfaPayload = app.jwt.verify<{ sub: string; purpose: string; email: string }>(parsed.data.mfaToken);
    } catch {
      return reply.code(401).send({ error: 'Invalid or expired MFA token' });
    }
    if (mfaPayload.purpose !== 'mfa_challenge') return reply.code(401).send({ error: 'Invalid token purpose' });

    const [user] = await db.select({
      id: users.id, email: users.email, role: users.role, orgId: users.orgId,
      depotIds: users.depotIds, mustChangePassword: users.mustChangePassword,
      tokenVersion: users.tokenVersion, totpBackupCodes: users.totpBackupCodes, deletedAt: users.deletedAt,
    }).from(users).where(eq(users.id, mfaPayload.sub)).limit(1);

    if (!user || user.deletedAt) return reply.code(401).send({ error: 'User not found' });
    const codes = (user.totpBackupCodes as string[] | null) ?? [];
    if (!codes.length) return reply.code(400).send({ error: 'No backup codes available' });

    let matchIdx = -1;
    for (let i = 0; i < codes.length; i++) {
      if (await bcrypt.compare(parsed.data.backupCode, codes[i])) { matchIdx = i; break; }
    }
    if (matchIdx === -1) {
      await logMfaEvent(user.id, user.email, 'mfa_backup_code_failed', { ip: req.ip });
      return reply.code(401).send({ error: 'Invalid backup code' });
    }

    const remaining = codes.filter((_, i) => i !== matchIdx);
    await db.update(users).set({ totpBackupCodes: remaining }).where(eq(users.id, user.id));
    await logMfaEvent(user.id, user.email, 'mfa_backup_code_used', { remaining: remaining.length, ip: req.ip });

    const jti = randomUUID();
    const familyId = randomUUID();
    const payload = {
      sub: user.id, email: user.email, role: user.role, orgId: user.orgId,
      depotIds: user.depotIds as string[], mfaVerified: true,
      ...(user.mustChangePassword ? { mustChangePw: true } : {}),
    };
    const tokens = signTokens(app, payload, user.tokenVersion, { jti, familyId });
    await seedMfaRefreshToken(user.id, familyId, jti, req);

    reply.setCookie('rt', tokens.refreshToken, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict', path: '/api/v1/auth/refresh',
    });
    return { accessToken: tokens.accessToken, remainingBackupCodes: remaining.length };
  });
};
