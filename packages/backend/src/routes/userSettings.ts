import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireOrgRole } from '../middleware/requireOrgRole.js';

const DEFAULT_PREFS = { route_completed: true, stop_failed: true, stop_assigned: true };

export const userSettingsRoutes: FastifyPluginAsync = async (app) => {
  // GET /orgs/:orgId/users/me/preferences
  app.get('/users/me/preferences', {
    preHandler: requireOrgRole('dispatcher', 'pharmacy_admin', 'super_admin', 'pharmacist'),
  }, async (req) => {
    const caller = req.user as { sub: string };
    const [user] = await db.select({ notificationPreferences: users.notificationPreferences })
      .from(users)
      .where(eq(users.id, caller.sub));
    return user?.notificationPreferences ?? DEFAULT_PREFS;
  });

  // PATCH /orgs/:orgId/users/me/preferences
  app.patch('/users/me/preferences', {
    preHandler: requireOrgRole('dispatcher', 'pharmacy_admin', 'super_admin', 'pharmacist'),
  }, async (req) => {
    const caller = req.user as { sub: string };
    const body = req.body as Partial<Record<'route_completed' | 'stop_failed' | 'stop_assigned', boolean>>;

    const [existing] = await db.select({ notificationPreferences: users.notificationPreferences })
      .from(users)
      .where(eq(users.id, caller.sub));

    const current = (existing?.notificationPreferences ?? DEFAULT_PREFS) as Record<string, boolean>;
    const merged = { ...current, ...body };

    await db.update(users)
      .set({ notificationPreferences: merged })
      .where(eq(users.id, caller.sub));

    return merged;
  });
};
