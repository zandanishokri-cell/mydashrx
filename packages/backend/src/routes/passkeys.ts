// P-ML18: WebAuthn passkey endpoints — NIST SP 800-63B rev4 AAL2, HIPAA §164.312(d)
// POST /auth/passkey/register/options    → generate registration options
// POST /auth/passkey/register/verify     → verify + store passkey
// POST /auth/passkey/authenticate/options → generate auth options
// POST /auth/passkey/authenticate/verify  → verify passkey, issue AT+RT
// GET  /auth/passkey/available            → check if user has any registered passkeys
import type { FastifyPluginAsync } from 'fastify';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { db } from '../db/connection.js';
import { passkeys, webauthnChallenges, users, refreshTokens, adminAuditLogs } from '../db/schema.js';
import { eq, and, gt, isNull, count, asc, inArray } from 'drizzle-orm';
import { signTokens } from '../services/auth.js';
import { randomUUID, createHash } from 'crypto';

const RP_NAME = 'MyDashRx';
const RP_ID = process.env.WEBAUTHN_RP_ID ?? 'mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
const ORIGIN = process.env.WEBAUTHN_ORIGIN ?? process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';

function buildDeviceName(ua: string | null): string {
  if (!ua) return 'Unknown device';
  if (/iPhone/i.test(ua)) return 'iPhone · ' + (/Safari/i.test(ua) && !/Chrome/i.test(ua) ? 'Safari' : 'App');
  if (/iPad/i.test(ua)) return 'iPad · Safari';
  if (/Android/i.test(ua)) return 'Android · ' + (/Chrome/i.test(ua) ? 'Chrome' : 'App');
  const os = /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Desktop';
  const br = /Edg/i.test(ua) ? 'Edge' : /Firefox/i.test(ua) ? 'Firefox' : /Chrome/i.test(ua) ? 'Chrome' : /Safari/i.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${br}`;
}

async function seedRefreshToken(userId: string, familyId: string, jti: string, req: { ip: string; headers: Record<string, string | string[] | undefined> }): Promise<void> {
  const now = new Date();
  const ua = (req.headers['user-agent'] as string | undefined) ?? null;
  await db.insert(refreshTokens).values({
    jti, familyId, userId, ip: req.ip, userAgent: ua,
    deviceName: buildDeviceName(ua),
    lastUsedAt: now,
    absoluteExpiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
    expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
  });
  // Enforce session cap (50 max)
  const [{ total }] = await db.select({ total: count() }).from(refreshTokens).where(and(eq(refreshTokens.userId, userId), eq(refreshTokens.status, 'active')));
  const over = (total ?? 0) - 50 + 1;
  if (over > 0) {
    const lru = await db.select({ jti: refreshTokens.jti }).from(refreshTokens).where(and(eq(refreshTokens.userId, userId), eq(refreshTokens.status, 'active'))).orderBy(asc(refreshTokens.createdAt)).limit(over);
    if (lru.length > 0) await db.update(refreshTokens).set({ status: 'revoked' }).where(inArray(refreshTokens.jti, lru.map(r => r.jti)));
  }
}

async function logPasskeyEvent(event: string, userId: string, email: string, ip: string, metadata?: Record<string, unknown>) {
  const zeroId = '00000000-0000-0000-0000-000000000000';
  await db.insert(adminAuditLogs).values({
    actorId: userId ?? zeroId,
    actorEmail: email,
    action: event,
    targetId: userId ?? zeroId,
    targetName: email,
    metadata: { ip, ...metadata },
  }).catch(() => {});
}

export const passkeyRoutes: FastifyPluginAsync = async (app) => {

  // GET /auth/passkey/available — check if caller has passkeys (used by login page)
  // Auth: requires valid AT (any role). Returns {available: boolean}.
  app.get('/available', {
    preHandler: async (req, reply) => {
      try { await req.jwtVerify(); } catch { reply.code(401).send({ error: 'Unauthorized' }); }
    },
  }, async (req) => {
    const user = req.user as { sub: string };
    const rows = await db.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.userId, user.sub)).limit(1);
    return { available: rows.length > 0 };
  });

  // POST /auth/passkey/register/options — generate challenge for passkey registration
  app.post('/register/options', {
    preHandler: async (req, reply) => {
      try { await req.jwtVerify(); } catch { reply.code(401).send({ error: 'Unauthorized' }); }
    },
  }, async (req) => {
    const user = req.user as { sub: string; email: string };
    const [dbUser] = await db.select({ name: users.name }).from(users).where(eq(users.id, user.sub)).limit(1);
    if (!dbUser) return (req as any).server.httpErrors?.notFound?.() ?? { error: 'User not found' };

    // Load existing credentials to exclude them (prevents duplicate registrations)
    const existing = await db.select({ credentialId: passkeys.credentialId }).from(passkeys).where(eq(passkeys.userId, user.sub));
    const excludeCredentials = existing.map(p => ({ id: p.credentialId }));

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userID: new TextEncoder().encode(user.sub),
      userName: user.email,
      userDisplayName: dbUser.name,
      excludeCredentials,
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    // Store challenge — expires 5 min
    await db.delete(webauthnChallenges).where(and(
      eq(webauthnChallenges.userId, user.sub),
      gt(webauthnChallenges.expiresAt, new Date()),
    ));
    await db.insert(webauthnChallenges).values({
      userId: user.sub,
      challenge: options.challenge,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    return options;
  });

  // POST /auth/passkey/register/verify — verify registration + store credential
  app.post('/register/verify', {
    preHandler: async (req, reply) => {
      try { await req.jwtVerify(); } catch { reply.code(401).send({ error: 'Unauthorized' }); }
    },
  }, async (req, reply) => {
    const user = req.user as { sub: string; email: string };
    const body = req.body as { response: any };

    const [challengeRow] = await db.select()
      .from(webauthnChallenges)
      .where(and(eq(webauthnChallenges.userId, user.sub), gt(webauthnChallenges.expiresAt, new Date())))
      .orderBy(webauthnChallenges.createdAt)
      .limit(1);

    if (!challengeRow) return reply.code(400).send({ error: 'No active challenge — request options first' });

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge: challengeRow.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: true,
      });
    } catch (err) {
      return reply.code(400).send({ error: 'Passkey verification failed', detail: (err as Error).message });
    }

    if (!verification.verified || !verification.registrationInfo) {
      return reply.code(400).send({ error: 'Passkey verification failed' });
    }

    const { credential, credentialDeviceType, credentialBackedUp, aaguid } = verification.registrationInfo;

    await db.insert(passkeys).values({
      userId: user.sub,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      aaguid: aaguid ?? null,
      transports: (body.response.response as any).transports ?? [],
    });

    // Clean up used challenge
    await db.delete(webauthnChallenges).where(eq(webauthnChallenges.id, challengeRow.id)).catch(() => {});

    logPasskeyEvent('passkey_registered', user.sub, user.email, req.ip, { deviceType: credentialDeviceType, backedUp: credentialBackedUp });

    return { verified: true };
  });

  // POST /auth/passkey/authenticate/options — generate challenge for passkey login
  // Body: { email: string } — public endpoint (pre-auth)
  app.post('/authenticate/options', async (req, reply) => {
    const { email } = req.body as { email: string };
    if (!email) return reply.code(400).send({ error: 'email required' });

    const [dbUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (!dbUser) {
      // Return empty options — don't reveal user existence
      const emptyOpts = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: 'preferred' });
      return emptyOpts;
    }

    const userPasskeys = await db.select({ credentialId: passkeys.credentialId, transports: passkeys.transports })
      .from(passkeys).where(eq(passkeys.userId, dbUser.id));

    if (userPasskeys.length === 0) {
      const emptyOpts = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: 'preferred' });
      return emptyOpts;
    }

    const allowCredentials = userPasskeys.map(pk => ({
      id: pk.credentialId,
      transports: ((pk.transports as string[] | undefined) ?? []) as any,
    }));

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials,
      userVerification: 'preferred',
    });

    // Store challenge
    await db.delete(webauthnChallenges).where(eq(webauthnChallenges.userId, dbUser.id));
    await db.insert(webauthnChallenges).values({
      userId: dbUser.id,
      challenge: options.challenge,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    return options;
  });

  // POST /auth/passkey/authenticate/verify — verify passkey assertion, issue AT+RT
  // Body: { email, response: AuthenticationResponseJSON }
  app.post('/authenticate/verify', async (req, reply) => {
    const { email, response: authResponse } = req.body as { email: string; response: any };
    if (!email || !authResponse) return reply.code(400).send({ error: 'email and response required' });

    const [dbUser] = await db.select()
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);
    if (!dbUser) return reply.code(401).send({ error: 'Invalid passkey' });

    const [challengeRow] = await db.select()
      .from(webauthnChallenges)
      .where(and(eq(webauthnChallenges.userId, dbUser.id), gt(webauthnChallenges.expiresAt, new Date())))
      .orderBy(webauthnChallenges.createdAt)
      .limit(1);
    if (!challengeRow) return reply.code(400).send({ error: 'No active challenge — request options first' });

    const [passkeyRow] = await db.select()
      .from(passkeys)
      .where(and(eq(passkeys.userId, dbUser.id), eq(passkeys.credentialId, authResponse.id)))
      .limit(1);
    if (!passkeyRow) return reply.code(401).send({ error: 'Passkey not found for this account' });

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: authResponse,
        expectedChallenge: challengeRow.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        credential: {
          id: passkeyRow.credentialId,
          publicKey: Buffer.from(passkeyRow.publicKey, 'base64url'),
          counter: passkeyRow.counter,
          transports: ((passkeyRow.transports as string[] | null) ?? []) as any,
        },
        requireUserVerification: true,
      });
    } catch (err) {
      return reply.code(401).send({ error: 'Passkey verification failed', detail: (err as Error).message });
    }

    if (!verification.verified) return reply.code(401).send({ error: 'Passkey verification failed' });

    // Update counter
    await db.update(passkeys)
      .set({ counter: verification.authenticationInfo.newCounter })
      .where(eq(passkeys.id, passkeyRow.id));

    // Clean up challenge
    await db.delete(webauthnChallenges).where(eq(webauthnChallenges.id, challengeRow.id)).catch(() => {});

    // Issue AT+RT — build JWT payload matching JWTPayload shape
    const jti = randomUUID();
    const familyId = randomUUID();
    const jwtPayload = {
      sub: dbUser.id,
      email: dbUser.email,
      role: dbUser.role,
      orgId: dbUser.orgId,
      name: dbUser.name,
      depotIds: (dbUser.depotIds as string[]) ?? [],
      mustChangePw: dbUser.mustChangePassword,
    };
    const tokens = signTokens(app as any, jwtPayload, dbUser.tokenVersion, { jti, familyId });
    await seedRefreshToken(dbUser.id, familyId, jti, req as any);

    logPasskeyEvent('passkey_authenticated', dbUser.id, dbUser.email, req.ip);

    return tokens;
  });
};
