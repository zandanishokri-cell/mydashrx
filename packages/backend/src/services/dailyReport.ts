import { db } from '../db/connection.js';
import { stops, routes, plans, organizations, users } from '../db/schema.js';
import { eq, and, gte, lte, isNull, sql } from 'drizzle-orm';

export async function sendDailyReport(orgId: string): Promise<void> {
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
  if (!org) return;

  const adminUsers = await db.select().from(users).where(
    and(eq(users.orgId, orgId), isNull(users.deletedAt))
  ).then(us => us.filter(u => ['pharmacy_admin', 'super_admin'].includes(u.role)));

  if (adminUsers.length === 0) return;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dayStart = new Date(yesterday); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(yesterday); dayEnd.setHours(23, 59, 59, 999);

  const yesterdayStops = await db.select({
    status: stops.status,
    cnt: sql<number>`count(*)::int`,
  }).from(stops).where(and(
    eq(stops.orgId, orgId),
    isNull(stops.deletedAt),
    gte(stops.createdAt, dayStart),
    lte(stops.createdAt, dayEnd),
  )).groupBy(stops.status);

  const byStatus: Record<string, number> = {};
  for (const r of yesterdayStops) byStatus[r.status] = r.cnt;
  const total = Object.values(byStatus).reduce((s, v) => s + v, 0);
  const completed = byStatus['completed'] ?? 0;
  const failed = byStatus['failed'] ?? 0;
  const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  const activeDriverCount = await db.select({ cnt: sql<number>`count(distinct ${routes.driverId})::int` })
    .from(routes)
    .innerJoin(plans, eq(routes.planId, plans.id))
    .where(and(
      eq(plans.orgId, orgId),
      eq(routes.status, 'completed'),
      gte(plans.createdAt, dayStart),
      lte(plans.createdAt, dayEnd),
    ))
    .then(r => r[0]?.cnt ?? 0);

  const dateStr = yesterday.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const html = buildEmailHtml({ orgName: org.name, date: dateStr, total, completed, failed, successRate, activeDriverCount });

  if (!process.env.RESEND_API_KEY) return;

  for (const user of adminUsers) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `MyDashRx Reports <reports@${process.env.SENDER_DOMAIN ?? 'cartana.life'}>`,
        to: user.email,
        subject: `${org.name} — Daily Delivery Report for ${dateStr}`,
        html,
        // P-DEL13: suppress tracking — report emails sent at scale; scanner link-rewrite risk
        track_clicks: false,
        track_opens: false,
      }),
    }).catch(console.error);
  }
}

function buildEmailHtml(data: {
  orgName: string; date: string; total: number; completed: number;
  failed: number; successRate: number; activeDriverCount: number;
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f7f8fc; margin: 0; padding: 20px; }
  .card { background: white; border-radius: 12px; padding: 24px; margin: 0 auto; max-width: 520px; border: 1px solid #e5e7eb; }
  .header { border-bottom: 1px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 20px; }
  .logo { color: #0F4C81; font-size: 20px; font-weight: 700; }
  .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 20px 0; }
  .stat { background: #f9fafb; border-radius: 8px; padding: 16px; text-align: center; }
  .stat-value { font-size: 28px; font-weight: 700; color: #111827; }
  .stat-label { font-size: 12px; color: #6b7280; margin-top: 4px; }
  .success { color: #059669; }
  .failure { color: #dc2626; }
  .footer { font-size: 12px; color: #9ca3af; text-align: center; margin-top: 16px; }
  .cta { display: block; background: #0F4C81; color: white; text-align: center; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 20px; font-weight: 600; }
</style></head>
<body>
  <div class="card">
    <div class="header">
      <div class="logo">MyDashRx</div>
      <div style="font-size:14px;color:#6b7280;margin-top:4px;">${data.orgName} — ${data.date}</div>
    </div>
    <h2 style="margin:0 0 4px;font-size:18px;">Yesterday's Delivery Summary</h2>
    <div class="stat-grid">
      <div class="stat"><div class="stat-value">${data.total}</div><div class="stat-label">Total Stops</div></div>
      <div class="stat"><div class="stat-value success">${data.successRate}%</div><div class="stat-label">Success Rate</div></div>
      <div class="stat"><div class="stat-value success">${data.completed}</div><div class="stat-label">Completed</div></div>
      <div class="stat"><div class="stat-value ${data.failed > 0 ? 'failure' : ''}">${data.failed}</div><div class="stat-label">Failed</div></div>
    </div>
    <p style="font-size:14px;color:#374151;margin:16px 0 0;">${data.activeDriverCount} driver${data.activeDriverCount !== 1 ? 's' : ''} active yesterday.</p>
    <a href="https://${process.env.APP_DOMAIN ?? 'cartana.life'}/dashboard/analytics" class="cta">View Full Analytics →</a>
    <div class="footer">MyDashRx · Unsubscribe in Settings</div>
  </div>
</body>
</html>`;
}
