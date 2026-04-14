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
): { accessToken: string; refreshToken: string } {
  const accessToken = app.jwt.sign(payload as object, {
    expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
  });
  const refreshToken = app.jwt.sign(
    { sub: payload.sub, type: 'refresh' } as object,
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
