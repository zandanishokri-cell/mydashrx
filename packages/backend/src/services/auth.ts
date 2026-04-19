import bcrypt from 'bcryptjs';
import { db } from '../db/connection.js';
import { users, roleEscalations } from '../db/schema.js';
import { eq, and, isNull, gt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { type JWTPayload, ROLE_PERMISSIONS } from '@mydash-rx/shared';

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// P-RBAC33: check for active JIT escalation for a user (null = no active escalation)
export async function getActiveEscalation(userId: string): Promise<{ toRole: string; expiresAt: Date } | null> {
  const [row] = await db.select({ toRole: roleEscalations.toRole, expiresAt: roleEscalations.expiresAt })
    .from(roleEscalations)
    .where(and(eq(roleEscalations.userId, userId), isNull(roleEscalations.revokedAt), gt(roleEscalations.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

export function signTokens(
  app: FastifyInstance,
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  tokenVersion?: number,
  rtMeta?: { jti: string; familyId: string },
  escalation?: { toRole: string; expiresAt: Date } | null,
): { accessToken: string; refreshToken: string } {
  // P-RBAC10: dispatcher and pharmacist get 5min AT (shorter window = less risk if stolen)
  const restrictedRoles = ['dispatcher', 'pharmacist'];
  const atExpiry = restrictedRoles.includes(payload.role as string)
    ? '5m'
    : (process.env.JWT_EXPIRES_IN ?? '15m');
  // P-RBAC21: always embed tenantId = orgId so routes never read orgId from client-supplied params
  // P-RBAC24: embed permissions[] derived from canonical ROLE_PERMISSIONS map
  // P-RBAC33: if active escalation, inject escalatedRole + its permissions into AT
  const effectiveRole = escalation ? escalation.toRole : (payload.role as string);
  const permissions = ROLE_PERMISSIONS[effectiveRole as keyof typeof ROLE_PERMISSIONS] ?? [];
  const escalationClaims = escalation
    ? { escalatedRole: escalation.toRole, escalationExpiresAt: escalation.expiresAt.toISOString() }
    : {};
  const accessToken = app.jwt.sign(
    { ...payload as object, tenantId: payload.orgId, permissions, ...escalationClaims, ...(rtMeta ? { jti: rtMeta.jti } : {}) },
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
