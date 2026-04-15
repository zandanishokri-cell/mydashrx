import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';
import { sendDailyReport } from '../services/dailyReport.js';

export const reportRoutes: FastifyPluginAsync = async (app) => {
  app.post('/send-daily', {
    preHandler: requireRole('pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };

    const adminUsers = await db.select().from(users).where(
      and(eq(users.orgId, orgId), isNull(users.deletedAt))
    ).then(us => us.filter(u => ['pharmacy_admin', 'super_admin'].includes(u.role)));

    await sendDailyReport(orgId);
    return { sent: true, recipients: adminUsers.length };
  });
};
