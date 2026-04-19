import bcrypt from 'bcryptjs';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { JWTPayload } from '@mydash-rx/shared';

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signTokens(
  app: FastifyInstance,
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  tokenVersion?: number,
  rtMeta?: { jti: string; familyId: string },
): { accessToken: string; refreshToken: string } {
  // P-RBAC10: dispatcher and pharmacist get 5min AT (shorter window = less risk if stolen)
  const restrictedRoles = ['dispatcher', 'pharmacist'];
  const atExpiry = restrictedRoles.includes(payload.role as string)
    ? '5m'
    : (process.env.JWT_EXPIRES_IN ?? '15m');
  // P-RBAC21: always embed tenantId = orgId so routes never read orgId from client-supplied params
  const accessToken = app.jwt.sign(
    { ...payload as object, tenantId: payload.orgId, ...(rtMeta ? { jti: rtMeta.jti } : {}) },
    { expiresIn: atExpiry },
  );
  const refreshToken = app.jwt.sign(
    {
      sub: payload.sub,
      type: 'refresh',
      ...(tokenVersion !== undefined ? { tv: tokenVersion } : {}),
      ...(rtMeta ? { jti: rtMeta.jti, familyId: rtMeta.familyId } : {}),
    } as object,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '90d' },
  );
  return { accessToken, refreshToken };
}

export async function findUserByEmail(email: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return user ?? null;
}

export async function findUserById(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
}
