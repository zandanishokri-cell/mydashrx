/**
 * P-DEL11: Resend bounce webhook handler
 * Receives email.bounced / email.complained events from Resend via Svix signature verification.
 * On hard bounce: sets users.bounceStatus=hard — all future sends to that address are suppressed.
 * On complaint: sets bounceStatus=complaint — same suppression.
 * P-DEL26: On soft bounce: increments softBounceCount, schedules retry in email_retry_queue.
 *   After 3 consecutive soft bounces: softBounceSuppressedUntil = NOW() + 7 days.
 * P-DEL29: On email.clicked: updates lead engagement counters.
 * RESEND_WEBHOOK_SECRET must be set in Render env vars (get from Resend dashboard → Webhooks).
 */
import type { FastifyPluginAsync } from 'fastify';
import { createHmac, timingSafeEqual } from 'crypto';
import { db } from '../db/connection.js';
import { users, emailRetryQueue, leadProspects } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { recordBounce } from '../lib/emailWarmup.js';

// P-DEL26: Retry delay schedule for soft bounces — attempt 1→15min, 2→1hr, 3→4hr, 4→12hr
const SOFT_BOUNCE_RETRY_DELAYS_MS = [15 * 60_000, 60 * 60_000, 4 * 60 * 60_000, 12 * 60 * 60_000];

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
        bounce?: { type?: string }; // 'soft' | 'hard' — Resend bounce sub-type
        click?: { link?: string };
        // Resend stores template metadata in tags
        tags?: Record<string, string>;
      };
    };

    const eventType = event?.type;
    const toAddresses = event?.data?.to ?? [];
    const emailId = event?.data?.email_id;
    const bounceType = (event?.data as any)?.bounce?.type as string | undefined; // 'soft' | 'hard'

    app.log.info({ eventType, toAddresses, emailId, bounceType }, '[resend-webhook] event received');

    if (eventType === 'email.bounced' || eventType === 'email.complained') {
      // P-DEL21: increment bounce counter on outreach subdomain for circuit breaker
      const from = (event?.data as any)?.from as string | undefined;
      const outreachDomain = process.env.OUTREACH_SENDER_DOMAIN ?? process.env.SENDER_DOMAIN;
      if (outreachDomain && from?.includes(outreachDomain)) {
        recordBounce('outreach').catch(() => {});
      }

      const isSoftBounce = eventType === 'email.bounced' && bounceType === 'soft';
      const bounceStatus = eventType === 'email.complained' ? 'complaint' : (isSoftBounce ? 'soft' : 'hard');

      for (const address of toAddresses) {
        const email = address.toLowerCase().trim();
        try {
          if (isSoftBounce) {
            // P-DEL26: soft bounce — increment counter, maybe suppress, schedule retry
            const [userRow] = await db.select({
              id: users.id,
              softBounceCount: users.softBounceCount,
            }).from(users).where(eq(users.email, email)).limit(1);

            if (userRow) {
              const newCount = (userRow.softBounceCount ?? 0) + 1;
              const suppress = newCount >= 3;
              await db.update(users).set({
                bounceStatus: 'soft',
                bouncedAt: new Date(),
                softBounceCount: newCount,
                softBounceLastAt: new Date(),
                ...(suppress ? { softBounceSuppressedUntil: new Date(Date.now() + 7 * 86_400_000) } : {}),
                ...(emailId ? { resendLastEmailId: emailId } : {}),
              }).where(eq(users.id, userRow.id));

              // Enqueue retry if under max attempts (4 retries total)
              const attemptIdx = Math.min(newCount - 1, SOFT_BOUNCE_RETRY_DELAYS_MS.length - 1);
              const nextRetryAt = new Date(Date.now() + SOFT_BOUNCE_RETRY_DELAYS_MS[attemptIdx]);

              // Only enqueue if we have the original email payload in tags (set by send helpers)
              const emailType = (event?.data as any)?.tags?.emailType as string | undefined;
              const subject = (event?.data as any)?.tags?.subject as string | undefined;
              const htmlBody = (event?.data as any)?.tags?.htmlBody as string | undefined;

              if (emailType && subject && htmlBody && !suppress) {
                await db.insert(emailRetryQueue).values({
                  userId: userRow.id,
                  emailType,
                  toAddress: email,
                  subject,
                  htmlBody,
                  attemptCount: newCount - 1,
                  nextRetryAt,
                } as any);
              }

              app.log.info({ email, newCount, suppress, nextRetryAt }, '[resend-webhook] soft bounce processed');
            }
          } else {
            // Hard bounce or complaint — permanent suppression
            await db.update(users)
              .set({
                bounceStatus,
                bouncedAt: new Date(),
                ...(emailId ? { resendLastEmailId: emailId } : {}),
              })
              .where(eq(users.email, email));
            app.log.info({ email, bounceStatus, emailId }, '[resend-webhook] user bounce status updated');
          }
        } catch (err) {
          app.log.error({ email, err }, '[resend-webhook] failed to update bounce status');
        }
      }
    }

    // P-DEL29: Track email click events for lead engagement hygiene
    if (eventType === 'email.clicked') {
      for (const address of toAddresses) {
        const email = address.toLowerCase().trim();
        db.execute(sql`
          UPDATE lead_prospects
          SET email_clicked_count = email_clicked_count + 1,
              last_email_clicked_at = now(),
              updated_at = now()
          WHERE LOWER(email) = ${email}
            AND deleted_at IS NULL
        `).catch(() => {});
      }
    }

    return reply.code(200).send({ received: true });
  });
};
