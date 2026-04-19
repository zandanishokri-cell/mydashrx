// P-COMP11: Pre-delivery Stripe copay payment SMS link
// When a stop transitions to en_route with codAmount > 0, this service:
// 1. Creates a Stripe Payment Link for the exact copay amount
// 2. Sends it via SMS to the patient before the driver arrives
// 3. Stripe webhook marks codCollected + codMethod='card_online' when payment completes
import Stripe from 'stripe';
import { db } from '../db/connection.js';
import { stops } from '../db/schema.js';
import { eq } from 'drizzle-orm';

let _stripe: Stripe | null = null;
function getStripe(): Stripe | null {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
  return _stripe;
}

export interface StopForPayment {
  id: string;
  codAmount: number; // cents (e.g. 1500 = $15.00)
  recipientName: string;
  recipientPhone: string;
  address: string;
  orgId: string;
}

/** Creates a Stripe Payment Link and sends it via SMS. Fire-and-forget: never throws. */
export async function sendCopayPaymentLink(stop: StopForPayment, sendSms: (to: string, msg: string) => Promise<void>): Promise<void> {
  const stripe = getStripe();
  if (!stripe) { console.warn('P-COMP11: STRIPE_SECRET_KEY not set — copay SMS link skipped'); return; }
  if (stop.codAmount <= 0) return;

  try {
    // Create a one-time-use Stripe Price and Payment Link
    const price = await stripe.prices.create({
      currency: 'usd',
      unit_amount: stop.codAmount,
      product_data: { name: `Pharmacy Delivery Copay — ${stop.address}` },
    });

    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { stopId: stop.id, orgId: stop.orgId },
      after_completion: { type: 'redirect', redirect: { url: `${process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app'}/payment-success` } },
    });

    // Persist the link token + sentAt
    await db.update(stops)
      .set({ paymentLinkToken: link.id, paymentLinkSentAt: new Date() })
      .where(eq(stops.id, stop.id));

    // Send SMS
    const dollars = (stop.codAmount / 100).toFixed(2);
    await sendSms(
      stop.recipientPhone,
      `Your MyDashRx delivery is on the way! Copay of $${dollars} due. Pay now to speed up delivery: ${link.url} — Reply STOP to opt out.`,
    );
    console.log(JSON.stringify({ event: 'copay_link_sent', stopId: stop.id, amount: stop.codAmount, linkId: link.id }));
  } catch (err) {
    // Never block delivery operations
    console.error('P-COMP11 copay link error (non-fatal):', err instanceof Error ? err.message : err);
  }
}

/** Called by the Stripe webhook when payment_intent.succeeded fires */
export async function markCopayPaid(stopId: string, paymentIntentId: string): Promise<void> {
  await db.update(stops).set({
    codCollected: true,
    codMethod: 'card_online',
    codCollectedAt: new Date(),
    paymentCompletedAt: new Date(),
    stripePaymentIntentId: paymentIntentId,
  }).where(eq(stops.id, stopId));
}
