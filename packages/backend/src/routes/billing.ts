import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { organizations, stops, drivers } from '../db/schema.js';
import { eq, and, gte, isNull } from 'drizzle-orm';
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
      db.select({ id: stops.id }).from(stops)
        .where(and(eq(stops.orgId, orgId), isNull(stops.deletedAt), gte(stops.createdAt, monthStart))),
      db.select({ id: drivers.id }).from(drivers)
        .where(and(eq(drivers.orgId, orgId), isNull(drivers.deletedAt))),
    ]);

    const stopsThisMonth = stopsRows.length;
    const driversActive = driversRows.length;
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
      stripeCustomerId: (org as any).stripeCustomerId ?? null,
      subscriptionStatus: 'active',
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
    if (!plan.price) return reply.code(400).send({ error: 'Enterprise plan requires contacting sales' });

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return reply.code(404).send({ error: 'Not found' });

    const PRICE_IDS: Record<string, string> = {
      growth: process.env.STRIPE_PRICE_GROWTH ?? '',
      pro: process.env.STRIPE_PRICE_PRO ?? '',
    };

    const session = await stripePost('/checkout/sessions', {
      mode: 'subscription',
      'line_items[0][price]': PRICE_IDS[body.plan] ?? '',
      'line_items[0][quantity]': '1',
      success_url: body.successUrl,
      cancel_url: body.cancelUrl,
      'metadata[orgId]': orgId,
      'metadata[plan]': body.plan,
      ...(org.name ? { 'customer_email': '' } : {}),
    });

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

    const stripeCustomerId = (org as any).stripeCustomerId;
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
  // TODO: Add Stripe webhook signature verification using STRIPE_WEBHOOK_SECRET
  // Requires raw body parsing — use addContentTypeParser for 'application/json' with rawBody: true
  app.post('/webhook', async (req, reply) => {
    const event = req.body as { type: string; data: { object: Record<string, unknown> } };

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const orgId = (session.metadata as Record<string, string>)?.orgId;
      const plan = (session.metadata as Record<string, string>)?.plan as PlanKey;
      if (orgId && plan && PLANS[plan]) {
        await db.update(organizations).set({ billingPlan: plan }).where(eq(organizations.id, orgId));
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      const metadata = (subscription as any).metadata as Record<string, string>;
      const orgId = metadata?.orgId;
      if (orgId) {
        await db.update(organizations).set({ billingPlan: 'starter' }).where(eq(organizations.id, orgId));
      }
    }

    return reply.code(200).send({ received: true });
  });
};
