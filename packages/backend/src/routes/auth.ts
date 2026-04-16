import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '../db/connection.js';
import { users, organizations, drivers } from '../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { findUserByEmail, findUserById, verifyPassword, signTokens, hashPassword } from '../services/auth.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const registerSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['driver', 'pharmacist']),
  depotId: z.string().uuid().optional(), // required for pharmacist
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

    if (role === 'pharmacist' && !depotId) {
      return reply.code(400).send({ error: 'depotId is required for pharmacy accounts' });
    }

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
      const tokens = signTokens(app, {
        sub: user.id,
        email: user.email,
        role: user.role,
        orgId: user.orgId,
        depotIds: user.depotIds as string[],
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

    return { user: updated };
  });
};
