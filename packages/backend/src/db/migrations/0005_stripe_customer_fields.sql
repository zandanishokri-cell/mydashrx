-- Migration 0005: Add Stripe customer tracking fields to organizations
-- Fixes: stripeCustomerId never persisted after checkout.session.completed
-- Fixes: subscriptionStatus hardcoded as 'active' — now stored in DB

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "stripe_customer_id" text,
  ADD COLUMN IF NOT EXISTS "stripe_subscription_id" text,
  ADD COLUMN IF NOT EXISTS "stripe_subscription_status" text DEFAULT 'inactive';
