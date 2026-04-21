import type { FastifyPluginAsync } from 'fastify';
import { createHmac, randomBytes } from 'crypto';
import { db } from '../db/connection.js';
import { drivers, stops, routes, plans, users, magicLinkTokens } from '../db/schema.js';
import { eq, and, isNull, sql, gte, lte, inArray } from 'drizzle-orm';
import { requireOrgRole } from '../middleware/requireOrgRole.js';
import { requireDepotAccess } from '../middleware/requireDepotAccess.js';
import { hashPassword } from '../services/auth.js';
import { checkDriverLimit } from '../utils/usageLimits.js';
import { todayInTz } from '../utils/date.js';

const MAGIC_LINK_SECRET = process.env.MAGIC_LINK_SECRET ?? process.env.JWT_SECRET ?? '';
const signToken = (t: string) => createHmac('sha256', MAGIC_LINK_SECRET).update(t).digest('hex');

export const driverRoutes: FastifyPluginAsync = async (app) => {
  // P-RBAC20: depot-scoped guard — dispatchers scoped to depot(s) only see relevant data
  app.get('/', {
    preHandler: [requireOrgRole('pharmacy_admin', 'dispatcher', 'super_admin'), requireDepotAccess()],
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    // Include total stop count (all time) and today's stop count
    const today = todayInTz();
    const rows = await db
      .select({
        id: drivers.id, orgId: drivers.orgId, name: drivers.name,
        email: drivers.email, phone: drivers.phone,
        drugCapable: drivers.drugCapable, vehicleType: drivers.vehicleType,
        status: drivers.status, currentLat: drivers.currentLat,
        currentLng: drivers.currentLng, lastPingAt: drivers.lastPingAt,
        totalStops: sql<number>`count(distinct ${stops.id})::int`,
      })
      .from(drivers)
      .leftJoin(routes, and(eq(routes.driverId, drivers.id), isNull(routes.deletedAt)))
      .leftJoin(stops, and(eq(stops.routeId, routes.id), isNull(stops.deletedAt)))
      .where(and(eq(drivers.orgId, orgId), isNull(drivers.deletedAt)))
      .groupBy(drivers.id);
    return rows;
  });

  app.get('/:driverId', {
    preHandler: requireOrgRole('pharmacy_admin', 'dispatcher', 'super_admin', 'driver'),
  }, async (req, reply) => {
    const { orgId, driverId } = req.params as { orgId: string; driverId: string };
    // Drivers may only view their own profile
    const jwtUser = (req as any).user;
    if (jwtUser?.role === 'driver' && jwtUser?.driverId !== driverId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const [driver] = await db
      .select({
        id: drivers.id, orgId: drivers.orgId, name: drivers.name,
        email: drivers.email, phone: drivers.phone,
        drugCapable: drivers.drugCapable, vehicleType: drivers.vehicleType,
        status: drivers.status, currentLat: drivers.currentLat,
        currentLng: drivers.currentLng, lastPingAt: drivers.lastPingAt,
      })
      .from(drivers)
      .where(and(eq(drivers.id, driverId), eq(drivers.orgId, orgId), isNull(drivers.deletedAt)))
      .limit(1);
    if (!driver) return reply.code(404).send({ error: 'Not found' });
    return driver;
  });

  app.post('/', { preHandler: requireOrgRole('pharmacy_admin', 'super_admin') }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = req.body as {
      name: string; email: string; phone: string; password: string;
      drugCapable?: boolean; vehicleType?: 'car' | 'van' | 'bicycle';
    };
    if (!body.name?.trim()) return reply.code(400).send({ error: 'Name is required' });
    if (!body.email?.trim()) return reply.code(400).send({ error: 'Email is required' });
    if (!body.password || body.password.length < 8) return reply.code(400).send({ error: 'Password must be at least 8 characters' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return reply.code(400).send({ error: 'Invalid email address' });
    }
    const limitCheck = await checkDriverLimit(orgId);
    if (!limitCheck.allowed) {
      return reply.code(402).send({
        error: 'Driver limit reached',
        message: `Your plan allows ${limitCheck.limit} active drivers. You have ${limitCheck.current}. Upgrade to add more drivers.`,
        current: limitCheck.current,
        limit: limitCheck.limit,
      });
    }
    // Before creating the drivers row, check users table for an existing row with this email.
    // Prior bug: we used .onConflictDoNothing() on the users insert, which silently skipped
    // re-registration attempts when the email already existed in a different org. Result:
    // the drivers row lived in this org but the users row (source of JWT orgId) stayed in the
    // old org, so driver login picked up the wrong orgId and saw zero routes.
    const [existingUser] = await db.select({ id: users.id, orgId: users.orgId, role: users.role })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);
    if (existingUser && existingUser.orgId !== orgId) {
      return reply.code(409).send({
        error: 'Email already registered to another organization',
        message: `This email is already registered in a different organization (role: ${existingUser.role}). Ask the platform admin to transfer or retire the existing account before re-registering here.`,
      });
    }

    const passwordHash = await hashPassword(body.password);
    const [driver] = await db.insert(drivers).values({
      orgId, name: body.name, email: body.email, phone: body.phone,
      passwordHash, drugCapable: body.drugCapable ?? false,
      vehicleType: body.vehicleType ?? 'car',
    }).returning();

    // Users row: either create fresh, or update the existing same-org row to re-affirm driver role + password
    if (existingUser) {
      await db.update(users)
        .set({ name: body.name, role: 'driver', passwordHash, mustChangePassword: true })
        .where(eq(users.id, existingUser.id));
    } else {
      await db.insert(users).values({
        orgId,
        email: body.email,
        name: body.name,
        role: 'driver',
        passwordHash,
        mustChangePassword: true,
        depotIds: [],
      });
    }

    const { passwordHash: _, ...safe } = driver;
    return reply.code(201).send(safe);
  });

  // POST /orgs/:orgId/drivers/:driverId/heal-user-org — self-heal for drivers with
  // users.orgId stuck in a different org (from pre-fix onConflictDoNothing bug).
  // Safe because: caller must be pharmacy_admin/super_admin in :orgId, AND the drivers row
  // :driverId must already exist in :orgId (so caller isn't "claiming" a stranger's email).
  app.post('/:driverId/heal-user-org', { preHandler: requireOrgRole('pharmacy_admin', 'super_admin') }, async (req, reply) => {
    const { orgId, driverId } = req.params as { orgId: string; driverId: string };
    const [driver] = await db.select({ id: drivers.id, email: drivers.email, orgId: drivers.orgId })
      .from(drivers)
      .where(and(eq(drivers.id, driverId), eq(drivers.orgId, orgId), isNull(drivers.deletedAt)))
      .limit(1);
    if (!driver) return reply.code(404).send({ error: 'Driver not found in this org' });

    // Find the users row — it's globally unique on email
    const [userRow] = await db.select({ id: users.id, orgId: users.orgId, role: users.role })
      .from(users)
      .where(eq(users.email, driver.email))
      .limit(1);
    if (!userRow) return reply.code(404).send({ error: 'No users row found for this driver email' });

    const changes = { usersMoved: false, staleDriversRemoved: 0, previousUserOrgId: userRow.orgId };
    if (userRow.orgId !== orgId) {
      await db.update(users).set({ orgId }).where(eq(users.id, userRow.id));
      changes.usersMoved = true;
      // Force the driver to re-login so their JWT picks up the new orgId + driverId
      await db.execute(sql`DELETE FROM refresh_tokens WHERE user_id = ${userRow.id}::uuid`);
    }

    // Delete any stale drivers rows in OTHER orgs for the same email (they'll never be usable now)
    const staleDrivers = await db.select({ id: drivers.id })
      .from(drivers)
      .where(and(eq(drivers.email, driver.email), sql`${drivers.orgId} != ${orgId}`, isNull(drivers.deletedAt)));
    if (staleDrivers.length > 0) {
      await db.update(drivers)
        .set({ deletedAt: new Date() })
        .where(and(eq(drivers.email, driver.email), sql`${drivers.orgId} != ${orgId}`, isNull(drivers.deletedAt)));
      changes.staleDriversRemoved = staleDrivers.length;
    }

    return { ok: true, driverId, email: driver.email, ...changes };
  });

  // GPS ping from driver app
  app.post('/:driverId/ping', { preHandler: requireOrgRole('driver', 'super_admin') }, async (req, reply) => {
    const { orgId, driverId } = req.params as { orgId: string; driverId: string };
    const { lat, lng } = req.body as { lat: number; lng: number };
    // Drivers can only ping for themselves; super_admin can ping any
    const jwtUser = (req as any).user;
    if (jwtUser?.role === 'driver' && jwtUser?.driverId !== driverId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    // Only transition to on_route if driver was available — don't clobber offline status
    await db.update(drivers).set({
      currentLat: lat, currentLng: lng, lastPingAt: new Date(),
    }).where(and(eq(drivers.id, driverId), eq(drivers.orgId, orgId)));
    await db.update(drivers).set({ status: 'on_route' })
      .where(and(eq(drivers.id, driverId), eq(drivers.orgId, orgId), eq(drivers.status, 'available')));
    return { ok: true };
  });

  app.patch('/:driverId/status', { preHandler: requireOrgRole('driver', 'dispatcher', 'super_admin') }, async (req, reply) => {
    const { orgId, driverId } = req.params as { orgId: string; driverId: string };
    const { status } = req.body as { status: 'available' | 'on_route' | 'offline' };
    if (!['available', 'on_route', 'offline'].includes(status)) {
      return reply.code(400).send({ error: 'Invalid status value' });
    }
    // Drivers can only update their own status
    const jwtUser = (req as any).user;
    if (jwtUser?.role === 'driver' && jwtUser?.driverId !== driverId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const [updated] = await db.update(drivers).set({ status })
      .where(and(eq(drivers.id, driverId), eq(drivers.orgId, orgId)))
      .returning();
    if (!updated) return reply.code(404).send({ error: 'Not found' });
    return { id: updated.id, status: updated.status };
  });

  app.patch('/:driverId', { preHandler: requireOrgRole('pharmacy_admin', 'dispatcher', 'super_admin') }, async (req, reply) => {
    const { orgId, driverId } = req.params as { orgId: string; driverId: string };
    const raw = req.body as Record<string, unknown>;
    // Whitelist: only allow safe, non-credential fields to prevent injection of passwordHash/email/status/deletedAt
    const updates: { name?: string; phone?: string; vehicleType?: 'car' | 'van' | 'bicycle'; drugCapable?: boolean } = {};
    if (typeof raw.name === 'string' && raw.name.trim()) updates.name = raw.name.trim();
    if (typeof raw.phone === 'string') updates.phone = raw.phone.trim();
    if (['car', 'van', 'bicycle'].includes(raw.vehicleType as string)) updates.vehicleType = raw.vehicleType as 'car' | 'van' | 'bicycle';
    if (typeof raw.drugCapable === 'boolean') updates.drugCapable = raw.drugCapable;
    if (Object.keys(updates).length === 0) return reply.code(400).send({ error: 'No valid fields to update' });
    const [updated] = await db.update(drivers).set(updates)
      .where(and(eq(drivers.id, driverId), eq(drivers.orgId, orgId)))
      .returning();
    if (!updated) return reply.code(404).send({ error: 'Not found' });
    const { passwordHash: _, ...safe } = updated;
    return safe;
  });

  app.delete('/:driverId', { preHandler: requireOrgRole('pharmacy_admin', 'super_admin') }, async (req, reply) => {
    const { orgId, driverId } = req.params as { orgId: string; driverId: string };
    // Block deletion if driver has an active route (scope to org via plans join)
    const [activeRoute] = await db
      .select({ id: routes.id })
      .from(routes)
      .innerJoin(plans, and(eq(plans.id, routes.planId), eq(plans.orgId, orgId)))
      .where(and(
        eq(routes.driverId, driverId),
        inArray(routes.status, ['pending', 'active']),
        isNull(routes.deletedAt),
      ))
      .limit(1);
    if (activeRoute) {
      return reply.code(409).send({ error: 'Driver has an active route. Reassign or complete the route before removing this driver.' });
    }
    await db.update(drivers).set({ deletedAt: new Date() })
      .where(and(eq(drivers.id, driverId), eq(drivers.orgId, orgId)));
    return reply.code(204).send();
  });

  // GET /orgs/:orgId/drivers/performance/bulk?driverIds=id1,id2
  app.get('/performance/bulk', {
    preHandler: requireOrgRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const { driverIds: rawIds } = req.query as { driverIds?: string };
    if (!rawIds?.trim()) return reply.code(400).send({ error: 'driverIds query param required' });
    const ids = rawIds.split(',').map(s => s.trim()).filter(Boolean).slice(0, 100);
    if (ids.length === 0) return reply.code(400).send({ error: 'No valid driverIds' });

    const from = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Date.now() - 30 * 86400000));
    const fromTs = new Date(from + 'T00:00:00Z');
    const toTs = new Date(todayInTz() + 'T23:59:59Z');

    // Single query: all stops for all requested drivers in the org over last 30 days
    const rows = await db
      .select({
        driverId: routes.driverId,
        total: sql<number>`count(${stops.id})::int`,
        completed: sql<number>`count(case when ${stops.status} = 'completed' then 1 end)::int`,
      })
      .from(stops)
      .innerJoin(routes, eq(stops.routeId, routes.id))
      .where(and(
        eq(stops.orgId, orgId),
        inArray(routes.driverId, ids),
        isNull(stops.deletedAt),
        gte(stops.createdAt, fromTs),
        lte(stops.createdAt, toTs),
      ))
      .groupBy(routes.driverId);

    const result: Record<string, { completionRate: number; totalStops: number }> = {};
    for (const r of rows) {
      if (r.driverId) {
        result[r.driverId] = {
          completionRate: r.total > 0 ? Math.round((r.completed / r.total) * 1000) / 10 : 0,
          totalStops: r.total,
        };
      }
    }
    // Fill in zeros for drivers with no stops in range
    for (const id of ids) {
      if (!result[id]) result[id] = { completionRate: 0, totalStops: 0 };
    }
    return result;
  });

  app.get('/:driverId/performance', {
    preHandler: requireOrgRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId, driverId } = req.params as { orgId: string; driverId: string };
    const query = req.query as { from?: string; to?: string };

    const to = query.to ?? todayInTz();
    const from = query.from ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Date.now() - 30 * 86400000));
    // Parse as UTC midnight to avoid server-local-timezone ambiguity
    const fromTs = new Date(from + 'T00:00:00Z');
    const toTs = new Date(to + 'T23:59:59Z');

    const [driver] = await db
      .select({ id: drivers.id, name: drivers.name })
      .from(drivers)
      .where(and(eq(drivers.id, driverId), eq(drivers.orgId, orgId), isNull(drivers.deletedAt)))
      .limit(1);
    if (!driver) return reply.code(404).send({ error: 'Not found' });

    // All stops for this driver in the period
    const driverStops = await db
      .select({
        id: stops.id,
        status: stops.status,
        failureReason: stops.failureReason,
        completedAt: stops.completedAt,
        createdAt: stops.createdAt,
        windowEnd: stops.windowEnd,
      })
      .from(stops)
      .innerJoin(routes, eq(stops.routeId, routes.id))
      .where(and(
        eq(stops.orgId, orgId),
        eq(routes.driverId, driverId),
        isNull(stops.deletedAt),
        gte(stops.createdAt, fromTs),
        lte(stops.createdAt, toTs),
      ));

    const total = driverStops.length;
    const completed = driverStops.filter(s => s.status === 'completed').length;
    const failed = driverStops.filter(s => s.status === 'failed').length;
    const completionRate = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;

    // On-time rate: completed stops with windowEnd that finished before the window closed
    const completedWithWindow = driverStops.filter(s => s.status === 'completed' && s.windowEnd);
    const onTimeCount = completedWithWindow.filter(s => s.completedAt && s.windowEnd && s.completedAt <= s.windowEnd).length;
    const onTimeRate = completedWithWindow.length > 0 ? Math.round((onTimeCount / completedWithWindow.length) * 1000) / 10 : null;

    // Daily breakdown
    const dailyMap = new Map<string, { total: number; completed: number; failed: number }>();
    for (const s of driverStops) {
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(s.createdAt);
      const entry = dailyMap.get(date) ?? { total: 0, completed: 0, failed: 0 };
      entry.total++;
      if (s.status === 'completed') entry.completed++;
      if (s.status === 'failed') entry.failed++;
      dailyMap.set(date, entry);
    }
    const daily = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }));

    const activeDays = dailyMap.size;
    const avgStopsPerDay = activeDays > 0 ? Math.round((total / activeDays) * 10) / 10 : 0;

    // Failure reasons
    const reasonMap = new Map<string, number>();
    for (const s of driverStops.filter(s => s.status === 'failed')) {
      const r = s.failureReason ?? 'unknown';
      reasonMap.set(r, (reasonMap.get(r) ?? 0) + 1);
    }
    const failureReasons = Array.from(reasonMap.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    // Rank among all drivers in org for the period
    const allDriverRows = await db
      .select({
        driverId: routes.driverId,
        total: sql<number>`count(${stops.id})::int`,
        completed: sql<number>`count(case when ${stops.status} = 'completed' then 1 end)::int`,
      })
      .from(stops)
      .innerJoin(routes, eq(stops.routeId, routes.id))
      .where(and(
        eq(stops.orgId, orgId),
        isNull(stops.deletedAt),
        gte(stops.createdAt, fromTs),
        lte(stops.createdAt, toTs),
      ))
      .groupBy(routes.driverId);

    const allRates = allDriverRows.map(r => ({
      driverId: r.driverId,
      rate: r.total > 0 ? r.completed / r.total : 0,
    })).sort((a, b) => b.rate - a.rate);

    const rankIdx = allRates.findIndex(r => r.driverId === driverId);
    const rank = rankIdx === -1 ? null : rankIdx + 1;
    const totalDrivers = allRates.length;

    return {
      driverId,
      driverName: driver.name,
      period: { from, to },
      summary: { totalStops: total, completed, failed, completionRate, avgStopsPerDay, activeDays, onTimeRate },
      daily,
      failureReasons,
      rank,
      totalDrivers,
    };
  });

  // P-ONB27: POST /orgs/:orgId/drivers/bulk-invite — CSV batch driver invite via magic links
  app.post('/bulk-invite', {
    preHandler: requireOrgRole('pharmacy_admin', 'super_admin'),
    schema: {
      body: {
        type: 'object',
        required: ['drivers'],
        properties: {
          drivers: {
            type: 'array',
            maxItems: 50,
            items: {
              type: 'object',
              required: ['name', 'email'],
              properties: {
                name:  { type: 'string', minLength: 1, maxLength: 200 },
                email: { type: 'string', format: 'email', maxLength: 254 },
                phone: { type: 'string', maxLength: 30 },
              },
              additionalProperties: false,
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const { drivers: invites } = req.body as { drivers: { name: string; email: string; phone?: string }[] };

    const dashUrl = process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
    const resendKey = process.env.RESEND_API_KEY;
    const senderDomain = process.env.SENDER_DOMAIN ?? 'mydashrx.com';

    const results: { email: string; status: 'invited' | 'already_exists' | 'failed'; error?: string }[] = [];

    for (const invite of invites) {
      try {
        const email = invite.email.toLowerCase().trim();

        // Skip if user already exists
        const [existing] = await db.select({ id: users.id }).from(users)
          .where(eq(users.email, email)).limit(1);
        if (existing) {
          results.push({ email, status: 'already_exists' });
          continue;
        }

        // Create driver record (passwordHash placeholder — driver authenticates via magic link invite)
        const inviteHash = await hashPassword(randomBytes(16).toString('hex'));
        const [driver] = await db.insert(drivers).values({
          orgId, name: invite.name, email, phone: invite.phone ?? '',
          passwordHash: inviteHash, drugCapable: false, vehicleType: 'car',
        }).returning({ id: drivers.id });

        // Create user record — placeholder password, driver signs in via invite magic link
        await db.insert(users).values({
          orgId, email, name: invite.name, role: 'driver',
          passwordHash: inviteHash, mustChangePassword: false, depotIds: [],
        }).onConflictDoNothing();

        // Generate 24hr magic link invite token
        const token = randomBytes(32).toString('hex');
        const tokenHash = signToken(token);
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours for invite links
        await db.insert(magicLinkTokens).values({ email, tokenHash, expiresAt });

        // Send invite email via Resend API (raw fetch — consistent with auth.ts pattern)
        if (resendKey) {
          const inviteUrl = `${dashUrl}/auth/verify?token=${token}`;
          fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
            body: JSON.stringify({
              from: `MyDashRx <hello@${senderDomain}>`,
              to: [email],
              subject: `You've been invited to deliver with MyDashRx`,
              html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
                <h2 style="color:#0F4C81">You're invited to join MyDashRx</h2>
                <p>Hi ${invite.name},</p>
                <p>Your pharmacy has added you as a delivery driver on MyDashRx. Click below to set up your account and start receiving routes.</p>
                <p style="margin:24px 0">
                  <a href="${inviteUrl}" style="background:#0F4C81;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">
                    Set Up My Driver Account →
                  </a>
                </p>
                <p style="color:#6b7280;font-size:13px">This link expires in 24 hours. If you have questions, contact your pharmacy admin.</p>
              </div>`,
            }),
          }).catch((e: unknown) => console.error('[BulkInvite] email failed:', email, e));
        }

        results.push({ email, status: 'invited' });
      } catch (err) {
        results.push({ email: invite.email, status: 'failed', error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    const invited = results.filter(r => r.status === 'invited').length;
    const alreadyExist = results.filter(r => r.status === 'already_exists').length;
    const failed = results.filter(r => r.status === 'failed').length;

    return reply.code(207).send({ invited, alreadyExist, failed, results });
  });
};
