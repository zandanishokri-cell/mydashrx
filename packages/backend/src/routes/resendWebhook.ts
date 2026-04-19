/**
 * P-DEL11: Resend bounce webhook handler
 * Receives email.bounced / email.complained events from Resend via Svix signature verification.
 * On hard bounce: sets users.bounceStatus=hard — all future sends to that address are suppressed.
 * On complaint: sets bounceStatus=complaint — same suppression.
 * RESEND_WEBHOOK_SECRET must be set in Render env vars (get from Resend dashboard → Webhooks).
 */
import type { FastifyPluginAsync } from 'fastify';
import { createHmac, timingSafeEqual } from 'crypto';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { recordBounce } from '../lib/emailWarmup.js';

// Svix signature verification — Resend uses Svix under the hood
// Headers: svix-id, svix-timestamp, svix-signature
function verifySvixSignature(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  rawBody: string,
): boolean {
  try {
    const toSign = `${svixId}.${svixTimestamp}.${rawBody}`;
    // Resend webhook secret format: "whsec_..." — strip prefix, base64-decode
    const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const expected = createHmac('sha256', secretBytes).update(toSign).digest('base64');
    const signatures = svixSignature.split(' ');
    return signatures.some((sig) => {
      const sigValue = sig.replace(/^v1,/, '');
      try {
        return timingSafeEqual(Buffer.from(sigValue, 'base64'), Buffer.from(expected, 'base64'));
      } catch { return false; }
    });
  } catch { return false; }
}

export const resendWebhookRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/v1/webhooks/resend — Resend email event webhook
  app.post('/resend', {
    config: { rawBody: true },
  }, async (req, reply) => {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) {
      // Not configured — acknowledge silently (don't break Resend retry loop)
      app.log.warn('[resend-webhook] RESEND_WEBHOOK_SECRET not set — skipping (configure in Render env)');
      return reply.code(200).send({ received: true });
    }

    const svixId = req.headers['svix-id'] as string | undefined;
    const svixTimestamp = req.headers['svix-timestamp'] as string | undefined;
    const svixSignature = req.headers['svix-signature'] as string | undefined;

    if (!svixId || !svixTimestamp || !svixSignature) {
      app.log.warn('[resend-webhook] SECURITY: Missing Svix headers — rejected');
      return reply.code(401).send({ error: 'Missing webhook signature headers' });
    }

    // Replay protection: reject if timestamp is > 5 minutes old
    const tsMs = parseInt(svixTimestamp, 10) * 1000;
    if (Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) {
      app.log.warn({ svixTimestamp }, '[resend-webhook] SECURITY: Webhook timestamp too old — rejected');
      return reply.code(401).send({ error: 'Webhook timestamp expired' });
    }

    const rawBody = typeof (req as { rawBody?: string }).rawBody === 'string'
      ? (req as { rawBody?: string }).rawBody!
      : JSON.stringify(req.body);

    const valid = verifySvixSignature(secret, svixId, svixTimestamp, svixSignature, rawBody);
    if (!valid) {
      app.log.warn('[resend-webhook] SECURITY: Invalid Svix signature — rejected');
      return reply.code(401).send({ error: 'Invalid webhook signature' });
    }

    const event = req.body as {
      type: string;
      data?: {
        email_id?: string;
        to?: string[];
        from?: string;
      };
    };

    const eventType = event?.type;
    const toAddresses = event?.data?.to ?? [];
    const emailId = event?.data?.email_id;

    app.log.info({ eventType, toAddresses, emailId }, '[resend-webhook] event received');

    if (eventType === 'email.bounced' || eventType === 'email.complained') {
      const bounceStatus = eventType === 'email.complained' ? 'complaint' : 'hard';

      // P-DEL21: increment bounce counter on outreach subdomain for circuit breaker
      const from = (event?.data as any)?.from as string | undefined;
      const outreachDomain = process.env.OUTREACH_SENDER_DOMAIN ?? process.env.SENDER_DOMAIN;
      if (outreachDomain && from?.includes(outreachDomain)) {
        recordBounce('outreach').catch(() => {}); // fire-and-forget, non-blocking
      }

      for (const address of toAddresses) {
        const email = address.toLowerCase().trim();
        try {
          await db.update(users)
            .set({
              bounceStatus,
              bouncedAt: new Date(),
              ...(emailId ? { resendLastEmailId: emailId } : {}),
            })
            .where(eq(users.email, email));
          app.log.info({ email, bounceStatus, emailId }, '[resend-webhook] user bounce status updated');
        } catch (err) {
          app.log.error({ email, err }, '[resend-webhook] failed to update bounce status');
        }
      }
    }

    return reply.code(200).send({ received: true });
  });
};
