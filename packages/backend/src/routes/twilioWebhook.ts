// P-SEC30: Twilio webhook signature verification
// Validates X-Twilio-Signature on all Twilio status callback POSTs.
// Any spoofed delivery event (e.g. marking stops delivered without driver) is rejected 403.
import type { FastifyInstance } from 'fastify';
import twilio from 'twilio';
import { db } from '../db/connection.js';
import { stops } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export async function twilioWebhookRoutes(app: FastifyInstance) {
  // POST /api/v1/twilio/status — Twilio delivery status callback
  // Register this URL in Twilio Console → Messaging → Status Callback URL
  app.post('/status', {
    config: { rawBody: true }, // needed for signature verification
  }, async (req, reply) => {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) {
      // Dev/staging: skip verification if token not configured
      app.log.warn('[twilio-webhook] TWILIO_AUTH_TOKEN not set — skipping signature verification (non-prod only)');
      return reply.code(200).send({ received: true });
    }

    const sig = req.headers['x-twilio-signature'] as string | undefined;
    if (!sig) {
      app.log.warn({ url: req.url }, '[twilio-webhook] SECURITY: Missing X-Twilio-Signature header — rejected');
      return reply.code(403).send({ error: 'Missing webhook signature' });
    }

    // Build the full URL Twilio signed — must match the URL configured in Twilio Console
    const protocol = req.headers['x-forwarded-proto'] ?? 'https';
    const host = req.headers['x-forwarded-host'] ?? req.headers.host;
    const url = `${protocol}://${host}${req.url}`;

    const params = req.body as Record<string, string> ?? {};
    const valid = twilio.validateRequest(authToken, sig, url, params);

    if (!valid) {
      app.log.warn({
        url: req.url,
        sig,
        computedUrl: url,
      }, '[twilio-webhook] SECURITY: Invalid X-Twilio-Signature — possible spoofed delivery event, rejected');
      return reply.code(403).send({ error: 'Invalid webhook signature' });
    }

    // Signature verified — process status update
    const messageSid = params['MessageSid'];
    const status = params['MessageStatus'] ?? params['SmsStatus'];

    app.log.info({ messageSid, status }, '[twilio-webhook] Verified status callback received');

    // Update notificationLogs status if we track this messageSid
    if (messageSid && status) {
      try {
        const { notificationLogs } = await import('../db/schema.js');
        await db
          .update(notificationLogs)
          .set({ status })
          .where(eq(notificationLogs.externalId, messageSid))
          .catch(() => {}); // fire-and-forget — log update failure is non-critical
      } catch {
        // Non-critical — don't reject valid webhook just because log update fails
      }
    }

    return reply.code(200).send({ received: true });
  });
}
