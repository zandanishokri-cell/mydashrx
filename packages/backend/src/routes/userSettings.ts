import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';

const DEFAULT_PREFS = { route_completed: true, stop_failed: true, stop_assigned: true };

export const userSettingsRoutes: FastifyPluginAsync = async (app) => {
  // GET /orgs/:orgId/users/me/preferences
  app.get('/users/me/preferences', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req) => {
    const caller = req.user as { id: string };
    const [user] = await db.select({ notificationPreferences: users.notificationPreferences })
      .from(users)
      .where(eq(users.id, caller.id));
    return user?.notificationPreferences ?? DEFAULT_PREFS;
  });

  // PATCH /orgs/:orgId/users/me/preferences
  app.patch('/users/me/preferences', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req) => {
    const caller = req.user as { id: string; orgId: string };
    const { orgId } = req.params as { orgId: string };
    const body = req.body as Partial<Record<'route_completed' | 'stop_failed' | 'stop_assigned', boolean>>;

    const [existing] = await db.select({ notificationPreferences: users.notificationPreferences })
      .from(users)
      .where(and(eq(users.id, caller.id), eq(users.orgId, orgId)));

    const current = (existing?.notificationPreferences ?? DEFAULT_PREFS) as Record<string, boolean>;
    const merged = { ...current, ...body };

    await db.update(users)
      .set({ notificationPreferences: merged })
      .where(and(eq(users.id, caller.id), eq(users.orgId, orgId)));

    return merged;
  });
};
