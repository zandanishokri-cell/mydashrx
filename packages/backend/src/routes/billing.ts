import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { organizations, stops, drivers } from '../db/schema.js';
import { eq, and, gte, isNull, count } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';

const PLANS = {
  starter:    { name: 'Starter',    price: 0,    stopLimit: 100,  driverLimit: 2,  features: ['Basic dispatch', 'Stop tracking', 'Analytics'] },
  growth:     { name: 'Growth',     price: 99,   stopLimit: 500,  driverLimit: 10, features: ['Everything in Starter', 'Route optimization', 'SMS notifications', 'Lead Finder (50 leads/mo)'] },
  pro:        { name: 'Pro',        price: 249,  stopLimit: 2000, driverLimit: 50, features: ['Everything in Growth', 'HIPAA Compliance Center', 'Michigan Compliance Panel', 'Unlimited leads', 'Priority support'] },
  enterprise: { name: 'Enterprise', price: null, stopLimit: null, driverLimit: null, features: ['Everything in Pro', 'Custom integrations', 'Dedicated account manager', 'Custom SLA', 'On-site training'] },
} as const;

type PlanKey = keyof typeof PLANS;

const stripeBase = 'https://api.stripe.com/v1';

async function stripePost(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`${stripeBase}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    const err = await res.json() as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Stripe error ${res.status}`);
  }
  return res.json();
}

// Org-scoped billing routes (prefix: /api/v1/orgs/:orgId/billing)
export const billingRoutes: FastifyPluginAsync = async (app) => {
  // GET /billing/plan
  app.get('/plan', { preHandler: requireRole('pharmacy_admin', 'super_admin') }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const user = req.user as { orgId: string; role: string };
    if (user.role !== 'super_admin' && user.orgId !== orgId) return reply.code(403).send({ error: 'Forbidden' });

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return reply.code(404).send({ error: 'Not found' });

    const plan = org.billingPlan as PlanKey;
    const planDetails = PLANS[plan];

    // Count stops this month
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [stopsRows, driversRows] = await Promise.all([
      db.select({ n: count() }).from(stops)
        .where(and(eq(stops.orgId, orgId), isNull(stops.deletedAt), gte(stops.createdAt, monthStart))),
      db.select({ n: count() }).from(drivers)
        .where(and(eq(drivers.orgId, orgId), isNull(drivers.deletedAt))),
    ]);

    const stopsThisMonth = stopsRows[0]?.n ?? 0;
    const driversActive = driversRows[0]?.n ?? 0;
    const stopLimit = planDetails.stopLimit;
    const driverLimit = planDetails.driverLimit;

    return {
      currentPlan: plan,
      planDetails,
      usage: {
        stopsThisMonth,
        stopLimit,
        driversActive,
        driverLimit,
        stopsPercent: stopLimit ? Math.round((stopsThisMonth / stopLimit) * 100) : 0,
      },
      stripeCustomerId: org.stripeCustomerId ?? null,
      subscriptionStatus: org.stripeSubscriptionStatus ?? 'inactive',
    };
  });

  // GET /billing/plans
  app.get('/plans', { preHandler: requireRole('pharmacy_admin', 'super_admin') }, async () => {
    return Object.entries(PLANS).map(([key, plan]) => ({ key, ...plan }));
  });

  // POST /billing/checkout
  app.post('/checkout', { preHandler: requireRole('pharmacy_admin', 'super_admin') }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const user = req.user as { orgId: string; role: string };
    if (user.role !== 'super_admin' && user.orgId !== orgId) return reply.code(403).send({ error: 'Forbidden' });

    if (!process.env.STRIPE_SECRET_KEY) {
      return reply.code(200).send({ error: 'Stripe not configured', configureUrl: 'https://dashboard.stripe.com' });
    }

    const body = req.body as { plan: PlanKey; successUrl: string; cancelUrl: string };
    if (!body.plan || !PLANS[body.plan]) return reply.code(400).send({ error: 'Invalid plan' });
    if (!body.successUrl || !body.cancelUrl) return reply.code(400).send({ error: 'successUrl and cancelUrl required' });

    const plan = PLANS[body.plan];
    if (plan.price === null) return reply.code(400).send({ error: 'Enterprise plan requires contacting sales' });

    const [org] = await db
      .select({ stripeCustomerId: organizations.stripeCustomerId, stripeSubscriptionStatus: organizations.stripeSubscriptionStatus })
      .from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return reply.code(404).send({ error: 'Not found' });

    // Prevent duplicate subscriptions — direct to portal for plan changes
    if (org.stripeSubscriptionStatus === 'active' || org.stripeSubscriptionStatus === 'trialing') {
      return reply.code(409).send({
        error: 'Already subscribed',
        message: 'You already have an active subscription. Use the billing portal to change your plan.',
      });
    }

    const PRICE_IDS: Record<string, string> = {
      growth: process.env.STRIPE_PRICE_GROWTH ?? '',
      pro: process.env.STRIPE_PRICE_PRO ?? '',
    };

    const priceId = PRICE_IDS[body.plan];
    if (!priceId) return reply.code(400).send({ error: `No Stripe price configured for plan: ${body.plan}. Set STRIPE_PRICE_${body.plan.toUpperCase()} env var.` });

    const checkoutParams: Record<string, string> = {
      mode: 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      success_url: body.successUrl,
      cancel_url: body.cancelUrl,
      'metadata[orgId]': orgId,
      'metadata[plan]': body.plan,
    };

    // Re-use existing Stripe customer if available to prevent duplicate customers
    if (org.stripeCustomerId) {
      checkoutParams.customer = org.stripeCustomerId;
    }

    const session = await stripePost('/checkout/sessions', checkoutParams);

    return { url: session.url };
  });

  // POST /billing/portal
  app.post('/portal', { preHandler: requireRole('pharmacy_admin', 'super_admin') }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const user = req.user as { orgId: string; role: string };
    if (user.role !== 'super_admin' && user.orgId !== orgId) return reply.code(403).send({ error: 'Forbidden' });

    if (!process.env.STRIPE_SECRET_KEY) {
      return reply.code(200).send({ error: 'Stripe not configured', configureUrl: 'https://dashboard.stripe.com' });
    }

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return reply.code(404).send({ error: 'Not found' });

    const stripeCustomerId = org.stripeCustomerId;
    if (!stripeCustomerId) return reply.code(400).send({ error: 'No Stripe customer found. Please subscribe first.' });

    const body = req.body as { returnUrl: string };
    const session = await stripePost('/billing_portal/sessions', {
      customer: stripeCustomerId,
      return_url: body.returnUrl ?? `${process.env.DASHBOARD_URL}/dashboard/billing`,
    });

    return { url: session.url };
  });
};

// Webhook route (no auth, prefix: /api/v1/billing)
export const billingWebhookRoutes: FastifyPluginAsync = async (app) => {
  // Stripe sends raw body — add raw body content type parser so we can verify signature
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    try {
      (req as any).rawBody = (body as Buffer).toString('utf8');
      done(null, JSON.parse((body as Buffer).toString('utf8')));
    } catch (e) {
      done(e as Error, undefined);
    }
  });

  app.post('/webhook', async (req, reply) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      if (process.env.NODE_ENV === 'production') {
        console.error('[billing-webhook] STRIPE_WEBHOOK_SECRET not set in production — rejecting webhook');
        return reply.code(500).send({ error: 'Webhook not configured' });
      }
      console.warn('[billing-webhook] STRIPE_WEBHOOK_SECRET not set — skipping verification (dev mode only)');
    }
    if (webhookSecret) {
      const sig = (req.headers['stripe-signature'] as string) ?? '';
      const rawBody = (req as any).rawBody as string ?? '';
      if (!sig || !rawBody) {
        return reply.code(400).send({ error: 'Missing signature or body' });
      }
      // Synchronous verification using crypto (avoid dynamic import in hot path)
      const { createHmac } = require('node:crypto') as typeof import('node:crypto');
      const parts = sig.split(',');
      const tPart = parts.find((p: string) => p.startsWith('t='));
      const v1Part = parts.find((p: string) => p.startsWith('v1='));
      if (!tPart || !v1Part) return reply.code(400).send({ error: 'Invalid signature format' });
      const timestamp = tPart.slice(2);
      const expectedSig = v1Part.slice(3);
      const signed = `${timestamp}.${rawBody}`;
      const computed = createHmac('sha256', webhookSecret).update(signed).digest('hex');
      // Constant-time compare to prevent timing attacks
      if (computed.length !== expectedSig.length) return reply.code(400).send({ error: 'Signature mismatch' });
      let diff = 0;
      for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ expectedSig.charCodeAt(i);
      if (diff !== 0) return reply.code(400).send({ error: 'Signature mismatch' });
      // Reject events older than 5 minutes (replay attack protection)
      if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
        return reply.code(400).send({ error: 'Event timestamp too old' });
      }
    }

    const event = req.body as { type: string; data: { object: Record<string, unknown> } };

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      // Only upgrade plan when payment was actually collected
      if (session.payment_status !== 'paid') {
        console.warn('[billing-webhook] checkout.session.completed with non-paid status:', session.payment_status);
        return reply.code(200).send({ received: true });
      }
      const orgId = (session.metadata as Record<string, string>)?.orgId;
      const plan = (session.metadata as Record<string, string>)?.plan as PlanKey;
      const customerId = session.customer as string | null;
      const subscriptionId = session.subscription as string | null;
      if (orgId && plan && PLANS[plan]) {
        await db.update(organizations).set({
          billingPlan: plan,
          ...(customerId ? { stripeCustomerId: customerId } : {}),
          ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
          // stripeSubscriptionStatus intentionally omitted — set by customer.subscription.updated
        }).where(eq(organizations.id, orgId));
      }
    }

    if (event.type === 'customer.subscription.updated') {
      const subscription = event.data.object;
      const customerId = (subscription as any).customer as string;
      const status = (subscription as any).status as string;
      if (customerId && status) {
        // Reverse-map price ID to plan key
        const PRICE_TO_PLAN: Record<string, string> = {
          [process.env.STRIPE_PRICE_GROWTH ?? '']: 'growth',
          [process.env.STRIPE_PRICE_PRO ?? '']: 'pro',
        };
        const priceId = (subscription as any).items?.data?.[0]?.price?.id;
        const newPlan = priceId ? PRICE_TO_PLAN[priceId] as PlanKey : undefined;
        await db.update(organizations)
          .set({
            stripeSubscriptionStatus: status,
            ...(newPlan ? { billingPlan: newPlan } : {}),
          })
          .where(eq(organizations.stripeCustomerId, customerId));
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      const customerId = (subscription as any).customer as string;
      if (customerId) {
        await db.update(organizations)
          .set({ billingPlan: 'starter', stripeSubscriptionStatus: 'cancelled', stripeSubscriptionId: null })
          .where(eq(organizations.stripeCustomerId, customerId));
      }
    }

    return reply.code(200).send({ received: true });
  });
};
