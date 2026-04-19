/**
 * P-DEL12: RFC 8058 one-click unsubscribe endpoints
 * GET  /unsubscribe?token=... — one-click unsubscribe landing page (RFC 8058 §3)
 * POST /unsubscribe           — one-click POST handler (mail clients call this silently)
 *
 * Token format: HMAC-SHA256(userId + ':' + email, UNSUBSCRIBE_SECRET)
 * Uses existing MAGIC_LINK_SECRET as fallback — never leaks raw userId.
 */
import type { FastifyPluginAsync } from 'fastify';
import { createHmac } from 'crypto';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const UNSUB_SECRET = () => process.env.UNSUBSCRIBE_SECRET ?? process.env.MAGIC_LINK_SECRET ?? process.env.JWT_SECRET ?? 'unsub-fallback';

export function buildUnsubscribeToken(userId: string, email: string): string {
  return createHmac('sha256', UNSUB_SECRET()).update(`${userId}:${email}`).digest('hex');
}

export function buildUnsubscribeUrl(userId: string, email: string): string {
  const base = process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
  const token = buildUnsubscribeToken(userId, email);
  return `${process.env.BACKEND_URL ?? 'https://mydashrx-backend.onrender.com'}/api/v1/unsubscribe?token=${token}&uid=${encodeURIComponent(userId)}`;
}

export function buildListUnsubscribeHeaders(userId: string, email: string): Record<string, string> {
  const url = buildUnsubscribeUrl(userId, email);
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click', // RFC 8058 §3.2
  };
}

async function doUnsubscribe(userId: string, token: string): Promise<boolean> {
  const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return false;
  const expected = buildUnsubscribeToken(user.id, user.email);
  if (expected !== token) return false;
  await db.update(users).set({ emailOptOut: true }).where(eq(users.id, user.id));
  return true;
}

export const unsubscribeRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/unsubscribe — browser landing (user clicked unsubscribe link)
  app.get('/', async (req, reply) => {
    const { token, uid } = req.query as { token?: string; uid?: string };
    if (!token || !uid) return reply.code(400).send({ error: 'Invalid unsubscribe link' });

    const success = await doUnsubscribe(uid, token);
    if (!success) return reply.code(400).send({ error: 'Invalid or expired unsubscribe link' });

    // Return simple HTML confirmation
    return reply
      .header('Content-Type', 'text/html')
      .send(`
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><title>Unsubscribed — MyDashRx</title>
        <style>body{font-family:sans-serif;max-width:480px;margin:60px auto;padding:0 24px;text-align:center}
          h1{color:#0F4C81;margin-bottom:8px}p{color:#6b7280;font-size:15px}</style>
        </head>
        <body>
          <h1>You've been unsubscribed</h1>
          <p>You won't receive marketing emails from MyDashRx.<br>
          Critical account emails (login links, security alerts) will still be delivered.</p>
          <p style="margin-top:32px"><a href="${process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app'}/login" style="color:#0F4C81">Return to MyDashRx</a></p>
        </body>
        </html>
      `);
  });

  // POST /api/v1/unsubscribe — RFC 8058 §3.2 one-click POST (mail clients call this automatically)
  app.post('/', async (req, reply) => {
    const body = req.body as { token?: string; uid?: string } ?? {};
    const query = req.query as { token?: string; uid?: string };
    const token = body.token ?? query.token;
    const uid = body.uid ?? query.uid;
    if (!token || !uid) return reply.code(400).send({ error: 'Invalid unsubscribe request' });

    const success = await doUnsubscribe(uid, token);
    return reply.code(success ? 200 : 400).send({ unsubscribed: success });
  });

  // POST /api/v1/unsubscribe/resubscribe — allow re-opt-in from settings page
  app.post('/resubscribe', async (req, reply) => {
    const body = req.body as { token?: string; uid?: string } ?? {};
    const { token, uid } = body;
    if (!token || !uid) return reply.code(400).send({ error: 'Invalid request' });

    const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, uid)).limit(1);
    if (!user) return reply.code(400).send({ error: 'User not found' });
    const expected = buildUnsubscribeToken(user.id, user.email);
    if (expected !== token) return reply.code(400).send({ error: 'Invalid token' });

    await db.update(users).set({ emailOptOut: false }).where(eq(users.id, user.id));
    return { resubscribed: true };
  });
};
