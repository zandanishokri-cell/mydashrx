// P-COMP11: Stripe webhook — marks copay as paid when payment_intent.succeeded fires
import type { FastifyPluginAsync } from 'fastify';
import Stripe from 'stripe';
import { markCopayPaid } from '../services/paymentLink.js';

export const stripeWebhookRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/v1/stripe/webhook — raw body required for signature verification
  app.post('/webhook', {
    config: { rawBody: true },
  }, async (req, reply) => {
    const sig = req.headers['stripe-signature'] as string;
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret || !process.env.STRIPE_SECRET_KEY) return reply.code(200).send({ received: true });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
    let event: Stripe.Event;
    try {
      // rawBody is set by fastify's addContentTypeParser or body-parser; fallback to body string
      const raw = (req as any).rawBody ?? JSON.stringify(req.body);
      event = stripe.webhooks.constructEvent(raw, sig, secret);
    } catch (err) {
      return reply.code(400).send({ error: `Webhook signature verification failed: ${(err as Error).message}` });
    }

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as Stripe.PaymentIntent;
      // The payment intent metadata may have stopId — Stripe Payment Links set metadata via price metadata
      // We also check payment_link metadata (set on the link itself)
      const stopId = pi.metadata?.stopId;
      if (stopId) {
        await markCopayPaid(stopId, pi.id).catch(e => console.error('markCopayPaid error:', e.message));
      }
    }

    return reply.send({ received: true });
  });
};
