import type { FastifyPluginAsync } from 'fastify';
import crypto from 'crypto';
import { db } from '../db/connection.js';
import { organizations, users, drivers, adminAuditLogs } from '../db/schema.js';
import { eq, isNull, and } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';
import bcrypt from 'bcryptjs';
import { checkDriverLimit } from '../utils/usageLimits.js';

async function logRoleChange(
  actorId: string, actorEmail: string,
  targetId: string, targetEmail: string,
  action: string, metadata: Record<string, unknown>
) {
  await db.insert(adminAuditLogs).values({
    actorId, actorEmail, action,
    targetId, targetName: targetEmail,
    metadata,
  }).catch((e: unknown) => { console.error('[AuditLog] role change insert failed:', e); });
}

export const organizationRoutes: FastifyPluginAsync = async (app) => {
  // GET /orgs — super_admin only
  app.get('/', { preHandler: requireRole('super_admin') }, async () =>
    db.select().from(organizations).where(isNull(organizations.deletedAt)),
  );

  // GET /orgs/:orgId
  app.get('/:orgId', {
    preHandler: requireRole('super_admin', 'pharmacy_admin', 'dispatcher'),
  }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const user = req.user as { orgId: string; role: string };
    if (user.role !== 'super_admin' && user.orgId !== orgId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return reply.code(404).send({ error: 'Not found' });
    return org;
  });

  // POST /orgs — super_admin only
  app.post('/', { preHandler: requireRole('super_admin') }, async (req, reply) => {
    const body = req.body as { name: string; timezone?: string };
    if (!body.name) return reply.code(400).send({ error: 'name required' });
    const [org] = await db
      .insert(organizations)
      .values({ name: body.name, timezone: body.timezone ?? 'America/New_York' })
      .returning();
    return reply.code(201).send(org);
  });

  // PATCH /orgs/:orgId
  app.patch('/:orgId', { preHandler: requireRole('super_admin', 'pharmacy_admin') }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const user = req.user as { orgId: string; role: string };
    if (user.role !== 'super_admin' && user.orgId !== orgId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const body = req.body as Partial<{ name: string; timezone: string }>;
    const updates: Partial<{ name: string; timezone: string }> = {};
    if (body.name !== undefined) {
      const trimmed = body.name.trim();
      if (!trimmed) return reply.code(400).send({ error: 'Organization name cannot be empty' });
      updates.name = trimmed;
    }
    if (body.timezone !== undefined) updates.timezone = body.timezone;
    const [updated] = await db
      .update(organizations)
      .set(updates)
      .where(eq(organizations.id, orgId))
      .returning();
    if (!updated) return reply.code(404).send({ error: 'Not found' });
    return updated;
  });

  // GET /orgs/:orgId/users
  app.get('/:orgId/users', { preHandler: requireRole('super_admin', 'pharmacy_admin') }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const user = req.user as { orgId: string; role: string };
    if (user.role !== 'super_admin' && user.orgId !== orgId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const rows = await db
      .select({
        id: users.id,
        orgId: users.orgId,
        email: users.email,
        name: users.name,
        role: users.role,
        depotIds: users.depotIds,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(and(eq(users.orgId, orgId), isNull(users.deletedAt)));
    return rows;
  });

  // PATCH /orgs/:orgId/users/:userId
  app.patch('/:orgId/users/:userId', { preHandler: requireRole('super_admin', 'pharmacy_admin') }, async (req, reply) => {
    const { orgId, userId } = req.params as { orgId: string; userId: string };
    const caller = req.user as { id: string; orgId: string; role: string };
    if (caller.role !== 'super_admin' && caller.orgId !== orgId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    // Prevent self-role-change via API (UI hides pencil but API must enforce too)
    if (caller.id === userId) {
      return reply.code(403).send({ error: 'Cannot change your own role' });
    }
    const body = req.body as Partial<{ name: string; role: string; depotIds: string[] }>;
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.role !== undefined) {
      const ASSIGNABLE_ROLES = ['pharmacy_admin', 'dispatcher', 'pharmacist', 'driver'];
      if (!ASSIGNABLE_ROLES.includes(body.role)) {
        return reply.code(400).send({ error: `Invalid role. Must be one of: ${ASSIGNABLE_ROLES.join(', ')}` });
      }
      // pharmacy_admin cannot assign pharmacy_admin role (only super_admin can promote to admin)
      if (caller.role === 'pharmacy_admin' && body.role === 'pharmacy_admin') {
        return reply.code(403).send({ error: 'Insufficient permissions to assign this role' });
      }
      // Enforce driver limit when promoting to driver role
      if (body.role === 'driver') {
        const driverLimitCheck = await checkDriverLimit(orgId);
        if (!driverLimitCheck.allowed) {
          return reply.code(402).send({
            error: 'Driver limit reached',
            message: `Your plan allows ${driverLimitCheck.limit} active drivers. You have ${driverLimitCheck.current}. Upgrade to add more drivers.`,
            current: driverLimitCheck.current,
            limit: driverLimitCheck.limit,
          });
        }
      }
      updates.role = body.role;
    }
    if (body.depotIds !== undefined) updates.depotIds = body.depotIds;
    const [updated] = await db
      .update(users)
      .set(updates)
      .where(and(eq(users.id, userId), eq(users.orgId, orgId)))
      .returning({ id: users.id, orgId: users.orgId, email: users.email, name: users.name, role: users.role, depotIds: users.depotIds, createdAt: users.createdAt });
    if (!updated) return reply.code(404).send({ error: 'Not found' });

    // HIPAA §164.312(b) — audit role/depot changes
    if (body.role !== undefined || body.depotIds !== undefined) {
      const actor = req.user as { id: string; email: string };
      const action = body.role !== undefined ? 'role_change' : 'depot_assign';
      await logRoleChange(actor.id, actor.email, updated.id, updated.email, action, {
        ...(body.role !== undefined ? { newRole: body.role } : {}),
        ...(body.depotIds !== undefined ? { newDepotIds: body.depotIds } : {}),
      });
    }

    return updated;
  });

  // DELETE /orgs/:orgId/users/:userId — soft delete
  app.delete('/:orgId/users/:userId', { preHandler: requireRole('super_admin', 'pharmacy_admin') }, async (req, reply) => {
    const { orgId, userId } = req.params as { orgId: string; userId: string };
    const requestor = req.user as { id: string; orgId: string; role: string };
    if (requestor.role !== 'super_admin' && requestor.orgId !== orgId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    if (requestor.id === userId) {
      return reply.code(400).send({ error: 'Cannot remove yourself' });
    }
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.orgId, orgId)));
    return reply.code(204).send();
  });

  // POST /orgs/:orgId/users/invite
  app.post('/:orgId/users/invite', { preHandler: requireRole('super_admin', 'pharmacy_admin') }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const requestor = req.user as { orgId: string; role: string };
    if (requestor.role !== 'super_admin' && requestor.orgId !== orgId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const body = req.body as { name: string; email: string; role: string; depotIds?: string[] };
    if (!body.name || !body.email || !body.role) {
      return reply.code(400).send({ error: 'name, email, and role are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return reply.code(400).send({ error: 'Invalid email address' });
    }
    const ASSIGNABLE_ROLES = ['pharmacy_admin', 'dispatcher', 'pharmacist', 'driver'];
    if (!ASSIGNABLE_ROLES.includes(body.role)) {
      return reply.code(400).send({ error: `Invalid role. Must be one of: ${ASSIGNABLE_ROLES.join(', ')}` });
    }
    if (requestor.role === 'pharmacy_admin' && body.role === 'pharmacy_admin') {
      return reply.code(403).send({ error: 'Insufficient permissions to assign this role' });
    }

    // Check if user already exists in org
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, body.email), eq(users.orgId, orgId), isNull(users.deletedAt)))
      .limit(1);
    if (existing) return reply.code(409).send({ error: 'User with this email already exists in the organization' });

    // Check driver limit BEFORE creating user row to prevent split-brain state
    if (body.role === 'driver') {
      const driverLimitCheck = await checkDriverLimit(orgId);
      if (!driverLimitCheck.allowed) {
        return reply.code(402).send({
          error: 'Driver limit reached',
          message: `Your plan allows ${driverLimitCheck.limit} active drivers. You have ${driverLimitCheck.current}. Upgrade to add more drivers.`,
          current: driverLimitCheck.current,
          limit: driverLimitCheck.limit,
        });
      }
    }

    const tempPassword = crypto.randomBytes(6).toString('base64url');
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const [newUser] = await db
      .insert(users)
      .values({
        orgId,
        email: body.email,
        name: body.name,
        role: body.role as 'pharmacy_admin' | 'dispatcher' | 'pharmacist' | 'driver',
        depotIds: body.depotIds ?? [],
        passwordHash,
        mustChangePassword: true,
      })
      .returning({ id: users.id, orgId: users.orgId, email: users.email, name: users.name, role: users.role, depotIds: users.depotIds, createdAt: users.createdAt });

    let driverId: string | undefined;
    if (body.role === 'driver') {
      const [driverRecord] = await db.insert(drivers).values({
        orgId,
        name: body.name,
        email: body.email,
        phone: '',
        passwordHash,
        vehicleType: 'car',
      }).returning({ id: drivers.id });
      driverId = driverRecord.id;
    }

    return reply.code(201).send({ user: newUser, tempPassword, ...(driverId ? { driverId } : {}) });
  });
};
