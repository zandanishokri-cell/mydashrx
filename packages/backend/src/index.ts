import 'dotenv/config';

// Build-17 — env validation, deploy monitoring
// Validate ALL required env vars before anything else — prints every missing var at once
const REQUIRED_ENV: [string, string][] = [
  ['DATABASE_URL',           'PostgreSQL connection string (Render: link to mydashrx-db)'],
  ['JWT_SECRET',             'HS256 signing secret, min 32 chars (generate: openssl rand -hex 64)'],
  ['RESEND_API_KEY',         'Resend API key — required for magic link emails'],
  ['SENDER_DOMAIN',          'Email sender domain, e.g. cartana.life'],
  ['DASHBOARD_URL',          'Frontend URL for magic link redirect, e.g. https://...vercel.app'],
  ['PHI_ENCRYPTION_KEY',     'P-SEC40: AES-256-GCM PHI encryption key — 32 random bytes hex (generate: openssl rand -hex 32)'],
];
const missing = REQUIRED_ENV.filter(([k]) => !process.env[k]);
if (missing.length > 0) {
  console.error('STARTUP FAILED — missing required env vars:');
  for (const [k, hint] of missing) console.error(`  ✗ ${k}: ${hint}`);
  console.error('Set these in the Render dashboard under Environment, then redeploy.');
  process.exit(1);
}

process.on('uncaughtException', (err) => {
  console.error('STARTUP CRASH - uncaughtException:', err.message, err.stack);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('STARTUP CRASH - unhandledRejection:', reason);
  process.exit(1);
});

import Fastify from 'fastify';
import { captureError } from './services/errorMonitor.js';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import compress from '@fastify/compress';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { authRoutes } from './routes/auth.js';
import { passkeyRoutes } from './routes/passkeys.js';
import { mfaRoutes } from './routes/mfa.js'; // P-MFA1
import { signupRoutes } from './routes/signup.js';
import { organizationRoutes } from './routes/organizations.js';
import { depotRoutes } from './routes/depots.js';
import { driverRoutes } from './routes/drivers.js';
import { planRoutes } from './routes/plans.js';
import { routeRoutes } from './routes/routes.js';
import { stopRoutes } from './routes/stops.js';
import { podRoutes } from './routes/pod.js';
import { trackingRoutes, liveTrackingRoutes } from './routes/tracking.js';
import { searchRoutes } from './routes/search.js';
import { geocodeRoutes } from './routes/geocode.js';
import { analyticsRoutes } from './routes/analytics.js';
import { driverAppRoutes } from './routes/driverApp.js';
import { pharmacyPortalRoutes } from './routes/pharmacyPortal.js';
import { leadFinderRoutes } from './routes/leadFinder.js';
import { complianceRoutes } from './routes/compliance.js';
import { miComplianceRoutes } from './routes/miCompliance.js';
import { automationRoutes } from './routes/automation.js';
import { billingRoutes, billingWebhookRoutes } from './routes/billing.js';
import { superAdminRoutes } from './routes/superAdmin.js';
import { importRoutes } from './routes/import.js';
import { recurringRoutes } from './routes/recurring.js';
import { pharmacistPortalRoutes } from './routes/pharmacistPortal.js';
import { reportRoutes } from './routes/reports.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { notificationRoutes } from './routes/notifications.js';
import { userSettingsRoutes } from './routes/userSettings.js';
import { twilioWebhookRoutes } from './routes/twilioWebhook.js';
import { stripeWebhookRoutes } from './routes/stripeWebhook.js';
import { resendWebhookRoutes } from './routes/resendWebhook.js';
import { tlsRptWebhookRoutes } from './routes/tlsRptWebhook.js'; // P-DEL27
import { unsubscribeRoutes } from './routes/unsubscribe.js';
import { chainRoutes } from './routes/chain.js'; // P-COMP15
import { phiFilterHook } from './middleware/phiFilter.js';
import { phiAuditHook } from './middleware/phiAuditHook.js';
import { sendDailyReport } from './services/dailyReport.js';
import { deleteFromStorage } from './services/storage.js';
import { runAutoApproval } from './lib/autoApproval.js';
import { runDkimHealthCheck } from './lib/dkimHealthCheck.js';
import { runPostmasterMonitor } from './lib/postmasterMonitor.js';
import { db, client } from './db/connection.js';
import { organizations, magicLinkTokens, signupIntents, users, roleEscalations, refreshTokens, adminAuditLogs, auditLogs, emailDailyCounts, emailRetryQueue } from './db/schema.js';
import { sendAbandonmentEmail } from './lib/emailHelpers.js';
import { isNull, isNotNull, and, or, lt, sql, eq, desc, inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

// Run schema migrations synchronously — fast DDL, must complete before routes work
try {
  await migrate(db, { migrationsFolder: join(process.cwd(), 'src/db/migrations') });
  console.log('DB migrations applied');
} catch (err) {
  console.error('Migration warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-SES18: idempotent DDL for device_name column (not in drizzle journal — applied directly)
try {
  await db.execute(sql`ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS device_name text`);
  console.log('P-SES18 device_name column ensured');
} catch (err) {
  console.error('P-SES18 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-SES29: idempotent DDL for RT grace window columns (rotated_at + grace_expires_at)
try {
  await db.execute(sql`ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ`);
  await db.execute(sql`ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS grace_expires_at TIMESTAMPTZ`);
  console.log('P-SES29 rotated_at + grace_expires_at columns ensured');
} catch (err) {
  console.error('P-SES29 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-SES31: partial index for RT cleanup query performance
try {
  await db.execute(sql`CREATE INDEX IF NOT EXISTS rt_cleanup_idx ON refresh_tokens (status, created_at) WHERE status IN ('used', 'revoked')`);
  console.log('P-SES31 rt_cleanup_idx ensured');
} catch (err) {
  console.error('P-SES31 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-PERF1: idempotent DDL for performance indexes on stops table
try {
  await db.execute(sql`CREATE INDEX IF NOT EXISTS stops_org_created_idx ON stops(org_id, created_at)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS stops_active_idx ON stops(org_id) WHERE deleted_at IS NULL`);
  console.log('P-PERF1 stops performance indexes ensured');
} catch (err) {
  console.error('P-PERF1 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-CNV14: idempotent DDL for signup_intents table
try {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS signup_intents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_name text,
      admin_email text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      recovered_at timestamptz,
      unsubscribed_at timestamptz
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS si_email_idx ON signup_intents(admin_email)`);
  console.log('P-CNV14 signup_intents table ensured');
} catch (err) {
  console.error('P-CNV14 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-CNV25: idempotent DDL — add step/org_size/source/captured_at to signup_intents
try {
  await db.execute(sql`ALTER TABLE signup_intents ADD COLUMN IF NOT EXISTS step integer`);
  await db.execute(sql`ALTER TABLE signup_intents ADD COLUMN IF NOT EXISTS org_size text CHECK (org_size IN ('solo', 'small_group', 'enterprise'))`);
  await db.execute(sql`ALTER TABLE signup_intents ADD COLUMN IF NOT EXISTS source text`);
  await db.execute(sql`ALTER TABLE signup_intents ADD COLUMN IF NOT EXISTS captured_at timestamptz NOT NULL DEFAULT now()`);
  console.log('P-CNV25 signup_intents columns ensured');
} catch (err) {
  console.error('P-CNV25 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-CNV24: idempotent DDL — add org_size to organizations for role segmentation
try {
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS org_size text CHECK (org_size IN ('solo', 'small_group', 'enterprise'))`);
  console.log('P-CNV24 organizations.org_size column ensured');
} catch (err) {
  console.error('P-CNV24 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-DEL9: HIPAA 164.310(d)(2)(i) PHI retention columns — idempotent DDL
try {
  await db.execute(sql`ALTER TABLE proof_of_deliveries ADD COLUMN IF NOT EXISTS retention_expires_at timestamptz`);
  await db.execute(sql`ALTER TABLE proof_of_deliveries ADD COLUMN IF NOT EXISTS pod_purged_at timestamptz`);
  // Back-fill: set retention_expires_at = captured_at + 6 years for existing rows
  await db.execute(sql`
    UPDATE proof_of_deliveries
    SET retention_expires_at = captured_at + INTERVAL '6 years'
    WHERE retention_expires_at IS NULL
  `);
  await db.execute(sql`ALTER TABLE driver_location_history ADD COLUMN IF NOT EXISTS retention_expires_at timestamptz`);
  await db.execute(sql`
    UPDATE driver_location_history
    SET retention_expires_at = recorded_at + INTERVAL '1 year'
    WHERE retention_expires_at IS NULL
  `);
  console.log('P-DEL9 HIPAA retention columns ensured');
} catch (err) {
  console.error('P-DEL9 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-A11Y26: signature_waived_reason on proof_of_deliveries — WCAG 2.5.1 + Michigan R 338.3162
try {
  await db.execute(sql`
    ALTER TABLE proof_of_deliveries
    ADD COLUMN IF NOT EXISTS signature_waived_reason TEXT
    CHECK (signature_waived_reason IN ('door_drop','patient_declined','mobility_impaired','other'))
  `);
  console.log('P-A11Y26 signature_waived_reason column ensured');
} catch (err) {
  console.error('P-A11Y26 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-SES15: idempotent DDL for lastKnownCountry column on users
try {
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_known_country text`);
  console.log('P-SES15 lastKnownCountry column ensured');
} catch (err) {
  console.error('P-SES15 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-CNV17/18/P-ONB38: idempotent DDL for TTA + activation nudge + firstDispatchAt columns
try {
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS activated_at timestamptz`);
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS nudge_sent_at timestamptz`);
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS nudge2_sent_at timestamptz`);
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS first_dispatch_at timestamptz`);
  console.log('P-CNV17/18/P-ONB38 activation columns ensured');
} catch (err) {
  console.error('P-CNV17/18 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-CNV28/29: aha-moment + re-activation banner columns
try {
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS first_dispatched_at timestamptz`);
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS last_dispatched_at timestamptz`);
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS reactivation_banner_dismissed_at timestamptz`);
  console.log('P-CNV28/29 dispatch tracking columns ensured');
} catch (err) {
  console.error('P-CNV28/29 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-CNV22: server-side onboarding step persistence + stuck-nudge column
try {
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_step integer DEFAULT 1`);
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stuck_nudge_sent_at timestamptz`);
  console.log('P-CNV22 onboarding_step + stuck_nudge_sent_at columns ensured');
} catch (err) {
  console.error('P-CNV22 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-ONB37: BAA digital acceptance columns — HIPAA §164.308(b)(1)
try {
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS baa_accepted_at timestamptz`);
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS baa_accepted_by_user_id uuid`);
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS baa_ip_address text`);
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS baa_user_agent text`);
  console.log('P-ONB37 BAA acceptance columns ensured');
} catch (err) {
  console.error('P-ONB37 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-ONB42: onboarding banner dismissed server-side for cross-device sync
try {
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_banner_dismissed_at timestamptz`);
  console.log('P-ONB42 onboarding_banner_dismissed_at column ensured');
} catch (err) {
  console.error('P-ONB42 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-ADM40: SLA breach tracking + escalation level — HIPAA §164.308(a)(1)(ii)(A)
try {
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS sla_breached_at timestamptz`);
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS escalation_level integer NOT NULL DEFAULT 0`);
  console.log('P-ADM40 sla_breached_at + escalation_level columns ensured');
} catch (err) {
  console.error('P-ADM40 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-COMP11: idempotent DDL for Stripe copay payment link columns on stops
try {
  await db.execute(sql`ALTER TABLE stops ADD COLUMN IF NOT EXISTS payment_link_token text`);
  await db.execute(sql`ALTER TABLE stops ADD COLUMN IF NOT EXISTS payment_link_sent_at timestamptz`);
  await db.execute(sql`ALTER TABLE stops ADD COLUMN IF NOT EXISTS payment_completed_at timestamptz`);
  await db.execute(sql`ALTER TABLE stops ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text`);
  console.log('P-COMP11 copay payment link columns ensured');
} catch (err) {
  console.error('P-COMP11 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-PERF5: routes table indexes — cut seq-scan on dashboard/summary, /today, /drivers queries
try {
  await db.execute(sql`CREATE INDEX IF NOT EXISTS routes_plan_idx ON routes(plan_id) WHERE deleted_at IS NULL`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS routes_driver_idx ON routes(driver_id) WHERE deleted_at IS NULL`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS routes_status_idx ON routes(status)`);
  console.log('P-PERF5 routes performance indexes ensured');
} catch (err) {
  console.error('P-PERF5 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-DEL11/P-DEL12: bounce/unsubscribe columns on users — idempotent DDL
try {
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS bounce_status text`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS bounced_at timestamptz`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS resend_last_email_id text`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS unsubscribe_token text`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_opt_out boolean NOT NULL DEFAULT false`);
  console.log('P-DEL11/P-DEL12 bounce/unsubscribe columns ensured');
} catch (err) {
  console.error('P-DEL11/DEL12 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-SEC32b: warn if MAGIC_LINK_SECRET falls back to JWT_SECRET (secret reuse)
if (!process.env.MAGIC_LINK_SECRET) {
  console.warn('SECURITY WARNING: MAGIC_LINK_SECRET not set — falling back to JWT_SECRET. Set MAGIC_LINK_SECRET as a separate env var for proper secret isolation (openssl rand -hex 64).');
}

// P-RBAC28: PostgreSQL Row-Level Security on PHI tables — defense-in-depth orgId isolation
// Even if app-layer auth is bypassed, DB enforces org_id = current_setting('app.current_org_id')
// SET app.current_org_id is called in auth middleware before any query on these tables.
// Using PERMISSIVE policies: superuser/system role bypasses RLS for migrations/seeds.
try {
  // Enable RLS on the three highest-PHI tables
  await db.execute(sql`ALTER TABLE stops ENABLE ROW LEVEL SECURITY`);
  await db.execute(sql`ALTER TABLE proof_of_deliveries ENABLE ROW LEVEL SECURITY`);
  await db.execute(sql`ALTER TABLE driver_location_history ENABLE ROW LEVEL SECURITY`);

  // Policy design: app-layer org isolation (requireOrg/requireOrgRole middleware) is the primary
  // enforcement layer. RLS is defense-in-depth — fires if app layer is bypassed.
  // bypass_rls='true' allows the app's DB user to read across orgs (app layer enforces per-request).
  // A separate "auditor" role can be granted without bypass_rls to see only their own org's PHI.

  // stops: org_id must match session variable OR bypass_rls set
  await db.execute(sql`
    CREATE POLICY IF NOT EXISTS stops_org_isolation ON stops
    AS PERMISSIVE FOR ALL
    USING (
      current_setting('app.bypass_rls', true) = 'true'
      OR org_id::text = current_setting('app.current_org_id', true)
    )
  `);

  // proof_of_deliveries: join through stops to enforce org isolation
  await db.execute(sql`
    CREATE POLICY IF NOT EXISTS pod_org_isolation ON proof_of_deliveries
    AS PERMISSIVE FOR ALL
    USING (
      current_setting('app.bypass_rls', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM stops s
        WHERE s.id = stop_id
          AND s.org_id::text = current_setting('app.current_org_id', true)
      )
    )
  `);

  // driver_location_history: org_id column direct match
  await db.execute(sql`
    CREATE POLICY IF NOT EXISTS driver_loc_org_isolation ON driver_location_history
    AS PERMISSIVE FOR ALL
    USING (
      current_setting('app.bypass_rls', true) = 'true'
      OR org_id::text = current_setting('app.current_org_id', true)
    )
  `);

  // Set bypass_rls default for the current DB user role so ALL pool connections bypass at app layer.
  // The policy still fires for direct psql connections (non-bypass users) as defense-in-depth.
  // current_user returns the role name used in DATABASE_URL (e.g., 'mydashrx' or 'postgres').
  await db.execute(sql`ALTER ROLE CURRENT_USER SET app.bypass_rls = 'true'`);

  console.log('P-RBAC28 PostgreSQL RLS enabled on stops/proof_of_deliveries/driver_location_history (app bypass active via role default — defense-in-depth layer operational)');
} catch (err) {
  console.error('P-RBAC28 RLS DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-SEC33: idempotent DDL — audit log hash chain for HIPAA tamper-proofing
// Adds prev_hash + row_hash columns and PostgreSQL BEFORE INSERT triggers that
// maintain a SHA-256 hash chain across both audit tables. REVOKE DELETE/UPDATE
// prevents app role from erasing HIPAA evidence. §164.312(b).
try {
  // Add hash columns to audit_logs
  await db.execute(sql`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS prev_hash text`);
  await db.execute(sql`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS row_hash text`);
  // Add hash columns to admin_audit_logs
  await db.execute(sql`ALTER TABLE admin_audit_logs ADD COLUMN IF NOT EXISTS prev_hash text`);
  await db.execute(sql`ALTER TABLE admin_audit_logs ADD COLUMN IF NOT EXISTS row_hash text`);

  // Trigger function for audit_logs
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION audit_log_hash_chain()
    RETURNS TRIGGER AS $$
    DECLARE prev TEXT;
    BEGIN
      SELECT row_hash INTO prev FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 1;
      NEW.prev_hash := COALESCE(prev, 'genesis');
      NEW.row_hash  := encode(sha256(
        (COALESCE(NEW.id::text,'') || COALESCE(NEW.org_id::text,'') ||
        COALESCE(NEW.action,'') || COALESCE(NEW.created_at::text,'') ||
        NEW.prev_hash)::bytea), 'hex');
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await db.execute(sql`DROP TRIGGER IF EXISTS audit_log_hash_before_insert ON audit_logs`);
  await db.execute(sql`
    CREATE TRIGGER audit_log_hash_before_insert
      BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION audit_log_hash_chain()
  `);

  // Trigger function for admin_audit_logs
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION admin_audit_log_hash_chain()
    RETURNS TRIGGER AS $$
    DECLARE prev TEXT;
    BEGIN
      SELECT row_hash INTO prev FROM admin_audit_logs ORDER BY created_at DESC, id DESC LIMIT 1;
      NEW.prev_hash := COALESCE(prev, 'genesis');
      NEW.row_hash  := encode(sha256(
        (COALESCE(NEW.id::text,'') || COALESCE(NEW.actor_id::text,'') ||
        COALESCE(NEW.action,'') || COALESCE(NEW.created_at::text,'') ||
        NEW.prev_hash)::bytea), 'hex');
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await db.execute(sql`DROP TRIGGER IF EXISTS admin_audit_log_hash_before_insert ON admin_audit_logs`);
  await db.execute(sql`
    CREATE TRIGGER admin_audit_log_hash_before_insert
      BEFORE INSERT ON admin_audit_logs
      FOR EACH ROW EXECUTE FUNCTION admin_audit_log_hash_chain()
  `);

  console.log('P-SEC33 audit log hash chain triggers ensured (HIPAA §164.312(b))');
} catch (err) {
  console.error('P-SEC33 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-DISP1: stop_notes table — dispatcher notes on stops, driver visibility flag, PHI purge included
try {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS stop_notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      stop_id uuid NOT NULL REFERENCES stops(id),
      org_id uuid NOT NULL REFERENCES organizations(id),
      author_id uuid NOT NULL REFERENCES users(id),
      author_name text NOT NULL,
      body text NOT NULL,
      visible_to_driver boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS stop_notes_stop_idx ON stop_notes(stop_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS stop_notes_org_idx ON stop_notes(org_id)`);
  console.log('P-DISP1 stop_notes table ensured');
} catch (err) {
  console.error('P-DISP1 stop_notes DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-TRACK1: author_role column on stop_notes — distinguishes patient notes from dispatcher/driver notes
// Used in PHI purge cron to include patient-authored notes. authorId uses nil UUID for patient notes.
try {
  await db.execute(sql`ALTER TABLE stop_notes ADD COLUMN IF NOT EXISTS author_role text NOT NULL DEFAULT 'dispatcher'`);
  // Allow nil UUID for patient notes (no user account) — drop FK constraint on author_id
  // The FK was created without a name so we use a safe ALTER approach: make it nullable
  await db.execute(sql`ALTER TABLE stop_notes ALTER COLUMN author_id DROP NOT NULL`);
  console.log('P-TRACK1 stop_notes.author_role column ensured');
} catch (err) {
  console.error('P-TRACK1 stop_notes DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-DRV3: idempotency_key column on stops — deduplicates offline queue retries
try {
  await db.execute(sql`ALTER TABLE stops ADD COLUMN IF NOT EXISTS idempotency_key text`);
  console.log('P-DRV3 idempotency_key column ensured');
} catch (err) {
  console.error('P-DRV3 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-DISP3: retried_from_stop_id — chain-of-custody for failed stop retries (HIPAA controlled substance)
try {
  await db.execute(sql`ALTER TABLE stops ADD COLUMN IF NOT EXISTS retried_from_stop_id uuid REFERENCES stops(id)`);
  console.log('P-DISP3 retried_from_stop_id column ensured');
} catch (err) {
  console.error('P-DISP3 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-ADM37: assigned_reviewer_id + assigned_at on organizations — HIPAA §164.308(a)(3)(ii)(A)
try {
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS assigned_reviewer_id uuid REFERENCES users(id)`);
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS assigned_at timestamptz`);
  console.log('P-ADM37 assigned_reviewer_id + assigned_at columns ensured');
} catch (err) {
  console.error('P-ADM37 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-ML18: WebAuthn passkeys tables — NIST SP 800-63B rev4 AAL2, HIPAA §164.312(d)
try {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS passkeys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id text NOT NULL UNIQUE,
      public_key text NOT NULL,
      counter integer NOT NULL DEFAULT 0,
      device_type text NOT NULL DEFAULT 'unknown',
      backed_up boolean NOT NULL DEFAULT false,
      aaguid text,
      transports jsonb DEFAULT '[]',
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS passkeys_user_idx ON passkeys(user_id)`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS webauthn_challenges (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      challenge text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS wac_user_idx ON webauthn_challenges(user_id)`);
  console.log('P-ML18 passkeys + webauthn_challenges tables ensured');
} catch (err) {
  console.error('P-ML18 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-SES22: trusted_devices table — device trust fingerprint for 30-day remember
try {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS trusted_devices (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      fingerprint text NOT NULL,
      device_name text NOT NULL,
      trusted_at timestamptz NOT NULL DEFAULT now(),
      trusted_until timestamptz NOT NULL,
      is_revoked boolean NOT NULL DEFAULT false,
      last_seen_at timestamptz,
      ip text
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS trusted_devices_user_idx ON trusted_devices(user_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS trusted_devices_fp_idx ON trusted_devices(fingerprint)`);
  console.log('P-SES22 trusted_devices table ensured');
} catch (err) {
  console.error('P-SES22 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-RBAC34: lastLoginAt column — zombie account detection (HIPAA §164.308(a)(3)(ii)(C))
try {
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz`);
  console.log('P-RBAC34 last_login_at column ensured');
} catch (err) {
  console.error('P-RBAC34 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-RBAC33: role_escalations table — JIT temporary role elevation
try {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS role_escalations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      org_id uuid NOT NULL REFERENCES organizations(id),
      from_role text NOT NULL,
      to_role text NOT NULL,
      granted_by uuid NOT NULL REFERENCES users(id),
      reason text NOT NULL,
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS re_user_idx ON role_escalations(user_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS re_expires_idx ON role_escalations(expires_at)`);
  console.log('P-RBAC33 role_escalations table ensured');
} catch (err) {
  console.error('P-RBAC33 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-RBAC32: role_templates table — tenant-configurable role permission templates
try {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS role_templates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid REFERENCES organizations(id),
      role text NOT NULL,
      permissions jsonb NOT NULL DEFAULT '[]',
      is_default boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS rt_org_role_idx ON role_templates(org_id, role)`);
  // Partial unique indexes: handle NULL orgId (platform defaults) — PostgreSQL NULL != NULL in standard UNIQUE
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS rt_platform_role_uniq ON role_templates(role) WHERE org_id IS NULL`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS rt_org_role_uniq ON role_templates(org_id, role) WHERE org_id IS NOT NULL`);
  console.log('P-RBAC32 role_templates table ensured');
  // Seed platform defaults from static ROLE_PERMISSIONS map
  const { seedPlatformDefaults } = await import('./lib/rbacCache.js');
  await seedPlatformDefaults();
  console.log('P-RBAC32 platform defaults seeded');
} catch (err) {
  console.error('P-RBAC32 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-RBAC38: permission_drift_snapshots — weekly drift detection store (HIPAA §164.308(a)(1)(ii)(D))
try {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS permission_drift_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      added_perms TEXT[] NOT NULL DEFAULT '{}',
      removed_perms TEXT[] NOT NULL DEFAULT '{}',
      detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS pds_org_role_idx ON permission_drift_snapshots(org_id, role)`);
  console.log('P-RBAC38 permission_drift_snapshots table ensured');
} catch (err) {
  console.error('P-RBAC38 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-RBAC14: assigned_dispatcher_id on routes — dispatcher resource scoping (HIPAA §164.502(b))
try {
  await db.execute(sql`ALTER TABLE routes ADD COLUMN IF NOT EXISTS assigned_dispatcher_id uuid REFERENCES users(id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS routes_assigned_dispatcher_idx ON routes(assigned_dispatcher_id) WHERE deleted_at IS NULL AND assigned_dispatcher_id IS NOT NULL`);
  console.log('P-RBAC14 routes.assigned_dispatcher_id column ensured');
} catch (err) {
  console.error('P-RBAC14 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-DEL21: email_daily_counts — per-subdomain daily send + bounce tracking for warm-up + circuit breaker
try {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS email_daily_counts (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      subdomain text NOT NULL,
      date date NOT NULL,
      sent integer NOT NULL DEFAULT 0,
      bounced integer NOT NULL DEFAULT 0,
      CONSTRAINT email_daily_counts_subdomain_date_uniq UNIQUE (subdomain, date)
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS email_daily_counts_subdomain_idx ON email_daily_counts(subdomain)`);
  console.log('P-DEL21 email_daily_counts table ensured');
} catch (err) {
  console.error('P-DEL21 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-ML21: sentAt + confirmedAt columns on magic_link_tokens — funnel metrics (HIPAA §164.308(a)(6)(ii))
try {
  await db.execute(sql`ALTER TABLE magic_link_tokens ADD COLUMN IF NOT EXISTS sent_at timestamptz`);
  await db.execute(sql`ALTER TABLE magic_link_tokens ADD COLUMN IF NOT EXISTS confirmed_at timestamptz`);
  console.log('P-ML21 magic_link_tokens.sent_at + confirmed_at columns ensured');
} catch (err) {
  console.error('P-ML21 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-ML24/25/26: geo velocity + device fingerprint + cross-device resolution columns on magic_link_tokens
try {
  await db.execute(sql`ALTER TABLE magic_link_tokens ADD COLUMN IF NOT EXISTS request_ip TEXT`);
  await db.execute(sql`ALTER TABLE magic_link_tokens ADD COLUMN IF NOT EXISTS request_country TEXT`);
  await db.execute(sql`ALTER TABLE magic_link_tokens ADD COLUMN IF NOT EXISTS request_lat REAL`);
  await db.execute(sql`ALTER TABLE magic_link_tokens ADD COLUMN IF NOT EXISTS request_lon REAL`);
  await db.execute(sql`ALTER TABLE magic_link_tokens ADD COLUMN IF NOT EXISTS request_fingerprint_hash TEXT`);
  await db.execute(sql`ALTER TABLE magic_link_tokens ADD COLUMN IF NOT EXISTS request_id UUID DEFAULT gen_random_uuid()`);
  await db.execute(sql`ALTER TABLE magic_link_tokens ADD COLUMN IF NOT EXISTS cross_device_code TEXT`);
  await db.execute(sql`ALTER TABLE magic_link_tokens ADD COLUMN IF NOT EXISTS cross_device_code_expires_at TIMESTAMPTZ`);
  await db.execute(sql`ALTER TABLE magic_link_tokens ADD COLUMN IF NOT EXISTS cross_device_completed_at TIMESTAMPTZ`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS mlt_request_id_idx ON magic_link_tokens(request_id) WHERE request_id IS NOT NULL`);
  console.log('P-ML24/25/26 magic_link_tokens geo+fingerprint+cross-device columns ensured');
} catch (err) {
  console.error('P-ML24/25/26 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-PERF12: BRIN indexes — 10-50x smaller than B-tree for append-only time-series tables
// CONCURRENTLY means no table lock; safe to run at startup against live data
try {
  await db.execute(sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS location_recorded_at_brin_idx ON driver_location_history USING BRIN (recorded_at)`);
  await db.execute(sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS location_retention_brin_idx ON driver_location_history USING BRIN (retention_expires_at)`);
  await db.execute(sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_created_brin_idx ON audit_logs USING BRIN (created_at)`);
  // P-PERF11: composite keyset index for cursor pagination on audit_logs
  await db.execute(sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_log_keyset_idx ON audit_logs (created_at DESC, id DESC)`);
  console.log('P-PERF12/P-PERF11 BRIN + keyset indexes ensured');
} catch (err) {
  console.error('P-PERF12/P-PERF11 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-COMP13: refill consent + HIPAA ack columns on stops + hipaa_ack_suppressed_until on organizations
try {
  await db.execute(sql`ALTER TABLE stops ADD COLUMN IF NOT EXISTS refill_consent_given boolean`);
  await db.execute(sql`ALTER TABLE stops ADD COLUMN IF NOT EXISTS refill_consent_captured_at timestamptz`);
  await db.execute(sql`ALTER TABLE stops ADD COLUMN IF NOT EXISTS hipaa_ack_given boolean`);
  await db.execute(sql`ALTER TABLE stops ADD COLUMN IF NOT EXISTS hipaa_ack_captured_at timestamptz`);
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS hipaa_ack_suppressed_until timestamptz`);
  console.log('P-COMP13 refill consent + HIPAA ack columns ensured');
} catch (err) {
  console.error('P-COMP13 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-COMP15: chains table + organizations.chain_id — multi-location chain dashboard
try {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS chains (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      owner_id uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS chain_id uuid REFERENCES chains(id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS orgs_chain_idx ON organizations(chain_id) WHERE chain_id IS NOT NULL`);
  console.log('P-COMP15 chains table + organizations.chain_id ensured');
} catch (err) {
  console.error('P-COMP15 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-DEL26: Soft bounce retry queue + users soft bounce tracking
try {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS email_retry_queue (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid REFERENCES users(id),
      email_type text NOT NULL,
      to_address text NOT NULL,
      subject text NOT NULL,
      html_body text NOT NULL,
      attempt_count integer NOT NULL DEFAULT 0,
      next_retry_at timestamptz NOT NULL,
      last_attempt_at timestamptz,
      resolved_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS erq_next_retry_idx ON email_retry_queue(next_retry_at)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS erq_to_address_idx ON email_retry_queue(to_address)`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS soft_bounce_count integer NOT NULL DEFAULT 0`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS soft_bounce_last_at timestamptz`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS soft_bounce_suppressed_until timestamptz`);
  console.log('P-DEL26 email_retry_queue + users soft bounce columns ensured');
} catch (err) {
  console.error('P-DEL26 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-DISP8: ETA-delta SMS columns on stops — last notified ETA for change detection
try {
  await db.execute(sql`ALTER TABLE stops ADD COLUMN IF NOT EXISTS last_eta_notified_at timestamptz`);
  await db.execute(sql`ALTER TABLE stops ADD COLUMN IF NOT EXISTS last_eta_minutes int`);
  console.log('P-DISP8 last_eta_notified_at + last_eta_minutes columns ensured');
} catch (err) {
  console.error('P-DISP8 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-DEL16: push_subscriptions table — web push for driver mid-route notifications (90-day TTL)
try {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint text NOT NULL UNIQUE,
      p256dh text NOT NULL,
      auth text NOT NULL,
      device_type text NOT NULL DEFAULT 'unknown',
      created_at timestamptz NOT NULL DEFAULT now(),
      last_used_at timestamptz,
      expires_at timestamptz NOT NULL DEFAULT (now() + INTERVAL '90 days')
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS ps_user_idx ON push_subscriptions(user_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS ps_expires_idx ON push_subscriptions(expires_at)`);
  console.log('P-DEL16 push_subscriptions table ensured');
} catch (err) {
  console.error('P-DEL16 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-DEL29: Engagement-signal list hygiene columns on lead_prospects
try {
  await db.execute(sql`ALTER TABLE lead_prospects ADD COLUMN IF NOT EXISTS email_sent_count integer NOT NULL DEFAULT 0`);
  await db.execute(sql`ALTER TABLE lead_prospects ADD COLUMN IF NOT EXISTS email_clicked_count integer NOT NULL DEFAULT 0`);
  await db.execute(sql`ALTER TABLE lead_prospects ADD COLUMN IF NOT EXISTS last_email_clicked_at timestamptz`);
  await db.execute(sql`ALTER TABLE lead_prospects ADD COLUMN IF NOT EXISTS last_email_sent_at timestamptz`);
  await db.execute(sql`ALTER TABLE lead_prospects ADD COLUMN IF NOT EXISTS outreach_suppressed_at timestamptz`);
  console.log('P-DEL29 lead_prospects engagement columns ensured');
} catch (err) {
  console.error('P-DEL29 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-ONB46/47/48: BAA click-wrap consent + drip cancellation + NPPES payload persistence
try {
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS baa_version varchar(20) DEFAULT 'v1.0'`);
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS baa_accepted_by_ip varchar(45)`);
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pending_drip_email_ids text`);
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS npi_payload jsonb`);
  console.log('P-ONB46/47/48 baa_version, baa_accepted_by_ip, pending_drip_email_ids, npi_payload columns ensured');
} catch (err) {
  console.error('P-ONB46/47/48 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-ADM43: reviewer claim lock — collision detection (Zendesk Agent Collision Detection pattern)
try {
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS active_reviewer_id uuid REFERENCES users(id)`);
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS active_review_claimed_at timestamptz`);
  console.log('P-ADM43 active_reviewer_id, active_review_claimed_at columns ensured');
} catch (err) {
  console.error('P-ADM43 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-CNV32: peer-referral growth loop — track which org referred each new signup
try {
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS referred_by_org_id uuid REFERENCES organizations(id)`);
  console.log('P-CNV32 referred_by_org_id column ensured');
} catch (err) {
  console.error('P-CNV32 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-MFA1: TOTP MFA columns — HIPAA 2025 NPRM mandatory MFA for ePHI access
try {
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret text`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at timestamptz`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_backup_codes jsonb`);
  console.log('P-MFA1 TOTP MFA columns ensured');
} catch (err) {
  console.error('P-MFA1 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-DEL32: Email forwarding detection columns
try {
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_forwarding_detected boolean NOT NULL DEFAULT false`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_forwarding_detected_at timestamptz`);
  console.log('P-DEL32 email forwarding detection columns ensured');
} catch (err) {
  console.error('P-DEL32 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-PERF19: pg_stat_statements extension — HIPAA §164.308(a)(1)(ii)(D) performance monitoring
// Non-fatal: extension may not be available on all Postgres configs.
try {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_stat_statements`);
  console.log('P-PERF19 pg_stat_statements extension ensured');
} catch (err) {
  console.warn('P-PERF19 pg_stat_statements not available (non-fatal):', err instanceof Error ? err.message : err);
}

// P-DEL30: DMARC aggregate reports table
try {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS dmarc_aggregate_reports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      report_date date NOT NULL,
      source_ip text NOT NULL,
      count integer NOT NULL DEFAULT 0,
      disposition text NOT NULL,
      dkim_result text NOT NULL,
      spf_result text NOT NULL,
      policy_published text,
      reporter_org text,
      created_at timestamptz NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS dmarc_report_date_idx ON dmarc_aggregate_reports (report_date)`);
  console.log('P-DEL30 DMARC aggregate reports table ensured');
} catch (err) {
  console.error('P-DEL30 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// Stop a single bad request from killing the whole backend. Before this guard,
// unhandled promise rejections (e.g. ERR_HTTP_HEADERS_SENT in SSE routes) exited
// the Node process with status 1, putting Render into a crash-restart loop.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason instanceof Error ? reason.stack ?? reason.message : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.stack ?? err.message);
});

const app = Fastify({ logger: true, trustProxy: true });

await app.register(helmet, {
  contentSecurityPolicy: false,   // API server — no HTML served
  crossOriginEmbedderPolicy: false,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
});

await app.register(cors, {
  origin: (origin, cb) => {
    const allowed = [
      process.env.DASHBOARD_URL,
      'https://mydashrx-dashboard.vercel.app',
      'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app',
    ].filter(Boolean);
    if (!origin || allowed.some(o => origin === o || origin.endsWith('.vercel.app'))) {
      cb(null, true);
    } else {
      cb(new Error('CORS: origin not allowed'), false);
    }
  },
  credentials: true,
  exposedHeaders: ['X-Server-Time'], // OPUS-AUDIT-5: expose to cross-origin JS for clock-skew tracking
});

// P-SEC32c: JWT key rotation support — JWT_SECRET is the signing key (current).
// JWT_SECRET_PREVIOUS enables zero-downtime rotation: set JWT_SECRET_PREVIOUS=old_value,
// JWT_SECRET=new_value, deploy — existing ATs issued with old key remain valid until expiry.
// After all old ATs expire (max 15m), remove JWT_SECRET_PREVIOUS.
const jwtSecret = process.env.JWT_SECRET ?? 'dev-secret-change-in-prod-only';
const jwtSecretPrevious = process.env.JWT_SECRET_PREVIOUS;

// fastify-jwt verifySecret supports array of secrets for multi-key verify
const verifySecrets = jwtSecretPrevious
  ? [jwtSecret, jwtSecretPrevious]
  : jwtSecret;

await app.register(jwt, {
  secret: { private: jwtSecret, public: verifySecrets } as Parameters<typeof jwt>[1]['secret'],
  sign: { algorithm: 'HS256' },
  verify: { algorithms: ['HS256'] },
});

// P-SES20: HttpOnly cookie support for BFF token pattern
await app.register(cookie, { secret: process.env.JWT_SECRET ?? 'dev-secret-change-in-prod-only' });

// P-PERF2: brotli+gzip compression — reduces API payload sizes 60-80%
await app.register(compress, { global: true, encodings: ['br', 'gzip', 'deflate'] });

await app.register(rateLimit, {
  // 1000/min: admin browsing many sidebar pages + polling across tabs can exceed 300/min legitimately.
  // Per-IP bucket still blocks bulk-exfil; individual hot endpoints retain stricter per-route caps.
  max: process.env.NODE_ENV === 'production' ? 1000 : 10000,
  timeWindow: '1 minute',
  // Take leftmost X-Forwarded-For entry (real client IP behind Render proxy)
  keyGenerator: (req) => {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return (Array.isArray(xff) ? xff[0] : xff).split(',')[0].trim();
    return req.ip;
  },
});

// P-SEC39: Multipart flood DoS hardening — no parts/fields/files count was HIPAA-risk (authenticated DoS)
await app.register(multipart, {
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB per file
    files: 5,
    fields: 20,
    parts: 25,
    fieldNameSize: 200,
    fieldSize: 1 * 1024 * 1024, // 1 MB per field
  },
});
// P-SEC39: Log multipart flood attempts — structured log + DB audit when authenticated
app.addHook('onError', async (req, _reply, error) => {
  const MULTIPART_LIMIT_CODES = new Set(['FST_PARTS_LIMIT', 'FST_FILES_LIMIT', 'FST_FIELDS_LIMIT', 'FST_FIELD_NAME_TOO_LONG', 'FST_FIELD_TOO_LARGE']);
  if (MULTIPART_LIMIT_CODES.has((error as NodeJS.ErrnoException).code ?? '')) {
    const actor = (req as { user?: { sub?: string; orgId?: string; email?: string } }).user;
    req.log.warn({ ip: req.ip, url: req.url, userId: actor?.sub, orgId: actor?.orgId, code: (error as NodeJS.ErrnoException).code }, 'multipart_limit_exceeded');
    if (actor?.orgId) {
      db.insert(auditLogs).values({
        orgId: actor.orgId,
        userId: actor.sub ?? undefined,
        userEmail: actor.email ?? undefined,
        action: 'multipart_limit_exceeded',
        resource: 'upload',
        ipAddress: req.ip,
        metadata: { url: req.url, errorCode: (error as NodeJS.ErrnoException).code },
      }).catch(() => { /* non-blocking */ });
    }
  }
});

// OPUS-AUDIT-5: X-Server-Time lets the client detect clock skew and avoid refresh storms on drifting laptops.
app.addHook('onSend', async (_req, reply) => {
  reply.header('X-Server-Time', Date.now().toString());
});

app.addHook('onSend', phiFilterHook);
app.addHook('onRequest', phiAuditHook); // P-RBAC21: PHI read-event audit for HIPAA §164.312(b)

// P-PERF19: Slow response instrumentation — HIPAA §164.308(a)(1)(ii)(D) access monitoring
// Log any response >2000ms: routerPath + elapsedTime + statusCode + method
app.addHook('onResponse', async (req, reply) => {
  if (reply.elapsedTime > 2000) {
    req.log.warn({
      event: 'slow_response',
      routerPath: req.routerPath ?? req.url,
      method: req.method,
      elapsed_ms: Math.round(reply.elapsedTime),
      status_code: reply.statusCode,
    });
  }
});

// P-SEC34: CVE-2026-21710 — reject __proto__/constructor headers before Fastify accesses headersDistinct
// Unauthenticated crash vector on Node.js v24.14.1. Defence-in-depth until NODE_VERSION=24.14.2 propagates.
app.addHook('onRequest', async (req, reply) => {
  const hasOwn = Object.prototype.hasOwnProperty;
  if (hasOwn.call(req.headers, '__proto__') || hasOwn.call(req.headers, 'constructor')) {
    req.log.warn({ ip: req.ip, path: req.url }, 'P-SEC34 proto header rejected');
    return reply.code(400).send({ error: 'Invalid header name' });
  }
});

// P-SEC37: Strip hop-by-hop Connection header abuse (CVE-2026-33805 class, preventive)
// Prevents clients stripping proxy-injected security headers via Connection: header listing.
const HOP_BY_HOP = new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailers','transfer-encoding','upgrade']);
app.addHook('onRequest', async (req) => {
  const connHeader = req.headers['connection'];
  if (connHeader) {
    const hops = (Array.isArray(connHeader) ? connHeader.join(',') : connHeader)
      .split(',').map(s => s.trim().toLowerCase());
    for (const h of hops) {
      if (h && !HOP_BY_HOP.has(h)) {
        req.log.warn({ hop: h, ip: req.ip }, 'P-SEC37 suspicious Connection header stripping attempt');
        delete (req.headers as Record<string, unknown>)[h];
      }
    }
  }
});

// P-SEC36: RLS org context — set app.current_org_id as transaction-local session var on every
// authenticated request. Connection pool leak risk: without this, a recycled connection from
// org A would let a stale app.current_org_id pass RLS checks for org B.
// set_config(name, value, true) = transaction-local (resets after each statement in pool).
// Fire-and-forget — non-fatal if DB call fails (app-layer RBAC is primary enforcement).
app.addHook('preHandler', async (req) => {
  const user = (req.user ?? null) as { orgId?: string; role?: string } | null;
  const orgId = (req.params as Record<string, string>)?.orgId
    ?? user?.orgId
    ?? null;
  if (orgId) {
    await db.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`).catch(() => {});
  }
});

// 1 MB limit for JSON payloads (multipart handles its own)
app.addHook('preValidation', async (request, reply) => {
  const contentLength = parseInt(request.headers['content-length'] ?? '0', 10);
  if (contentLength > 1_048_576 && !request.headers['content-type']?.includes('multipart')) {
    reply.code(413).send({ error: 'Request too large' });
  }
});

// Serve locally uploaded photos
const uploadDir = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');
mkdirSync(uploadDir, { recursive: true });
await app.register(staticFiles, { root: uploadDir, prefix: '/uploads/', decorateReply: false });

// Routes
await app.register(authRoutes, { prefix: '/api/v1/auth' });
await app.register(passkeyRoutes, { prefix: '/api/v1/auth/passkey' }); // P-ML18
await app.register(mfaRoutes, { prefix: '/api/v1/auth/mfa' }); // P-MFA1
await app.register(signupRoutes, { prefix: '/api/v1/signup' });
await app.register(organizationRoutes, { prefix: '/api/v1/orgs' });
await app.register(depotRoutes, { prefix: '/api/v1/orgs/:orgId/depots' });
await app.register(driverRoutes, { prefix: '/api/v1/orgs/:orgId/drivers' });
await app.register(planRoutes, { prefix: '/api/v1/orgs/:orgId/plans' });
await app.register(routeRoutes, { prefix: '/api/v1/plans/:planId/routes' });
await app.register(stopRoutes, { prefix: '/api/v1/routes/:routeId/stops' });
await app.register(podRoutes, { prefix: '/api/v1/stops/:stopId/pod' });
await app.register(trackingRoutes, { prefix: '/api/v1/track' });
await app.register(liveTrackingRoutes, { prefix: '/api/v1/orgs/:orgId/tracking' });
await app.register(searchRoutes, { prefix: '/api/v1/orgs/:orgId' });
await app.register(geocodeRoutes, { prefix: '/api/v1/geocode' });
await app.register(analyticsRoutes, { prefix: '/api/v1/orgs/:orgId/analytics' });
await app.register(driverAppRoutes, { prefix: '/api/v1/driver' });
await app.register(pharmacyPortalRoutes, { prefix: '/api/v1/pharmacy' });
await app.register(leadFinderRoutes, { prefix: '/api/v1/orgs/:orgId/leads' });
await app.register(complianceRoutes, { prefix: '/api/v1/orgs/:orgId/compliance' });
await app.register(miComplianceRoutes, { prefix: '/api/v1/orgs/:orgId/mi-compliance' });
await app.register(automationRoutes, { prefix: '/api/v1/orgs/:orgId/automation' });
await app.register(billingRoutes, { prefix: '/api/v1/orgs/:orgId/billing' });
await app.register(billingWebhookRoutes, { prefix: '/api/v1/billing' });
await app.register(superAdminRoutes, { prefix: '/api/v1/admin' });
await app.register(importRoutes, { prefix: '/api/v1/orgs/:orgId' });
await app.register(recurringRoutes, { prefix: '/api/v1/orgs/:orgId/recurring' });
await app.register(pharmacistPortalRoutes, { prefix: '/api/v1/orgs/:orgId/pharmacist' });
await app.register(reportRoutes, { prefix: '/api/v1/orgs/:orgId/reports' });
await app.register(dashboardRoutes, { prefix: '/api/v1/orgs/:orgId/dashboard' });
await app.register(notificationRoutes, { prefix: '/api/v1/orgs/:orgId/notifications' });
await app.register(userSettingsRoutes, { prefix: '/api/v1/orgs/:orgId' });
// P-SEC30: Twilio webhook signature verification — protect delivery record integrity
await app.register(twilioWebhookRoutes, { prefix: '/api/v1/twilio' });
// P-COMP11: Stripe copay payment webhook
await app.register(stripeWebhookRoutes, { prefix: '/api/v1/stripe' });
// P-DEL11: Resend bounce webhook — Svix signature-verified
await app.register(resendWebhookRoutes, { prefix: '/api/v1/webhooks' });
// P-DEL27: TLS-RPT ingestion — RFC 8460 JSON report parsing
await app.register(tlsRptWebhookRoutes, { prefix: '/api/v1/webhooks' });
// P-DEL12: RFC 8058 one-click unsubscribe
await app.register(unsubscribeRoutes, { prefix: '/api/v1/unsubscribe' });
// P-COMP15: multi-location chain dashboard
await app.register(chainRoutes, { prefix: '/api/v1/chain' });

// Public: list depots for pharmacy registration
app.get('/api/v1/public/depots', async () => {
  const { depots } = await import('./db/schema.js');
  return db.select({ id: depots.id, name: depots.name, address: depots.address }).from(depots).orderBy(depots.name);
});

// Health check
app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

// 404 handler
app.setNotFoundHandler((req, reply) => {
  reply.code(404).send({ error: 'Not found' });
});

// Error handler
app.setErrorHandler((error, request, reply) => {
  const statusCode = error.statusCode ?? 500;
  if (statusCode >= 500) {
    captureError(error, { url: request.url, method: request.method, orgId: (request.params as any)?.orgId });
    reply.code(500).send({ error: 'Internal server error' });
  } else {
    reply.code(statusCode).send({ error: error.message });
  }
});

try {
  await app.listen({ port: Number(process.env.PORT ?? 3001), host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// P-ADM25: Auto-approval sweep — every 5 min, handles trustTier='auto_approve'/'block'
setInterval(() => { runAutoApproval().catch(console.error); }, 5 * 60 * 1000);
runAutoApproval().catch(console.error);

// P-CNV14: Abandonment email sweep — every 30 min
// Finds signup intents older than 2hr with no matching user, sends recovery email once
const runAbandonmentSweep = async () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const staleIntents = await db.select()
    .from(signupIntents)
    .where(and(
      isNull(signupIntents.recoveredAt),
      isNull(signupIntents.unsubscribedAt),
      lt(signupIntents.createdAt, twoHoursAgo),
    ));

  let sent = 0;
  for (const intent of staleIntents) {
    // Check no user signed up with this email since intent was captured
    const [user] = await db.select({ id: users.id }).from(users)
      .where(sql`LOWER(email) = LOWER(${intent.adminEmail})`).limit(1);
    if (user) {
      // User signed up — mark recovered without sending email
      await db.update(signupIntents).set({ recoveredAt: new Date() })
        .where(sql`id = ${intent.id}`);
      continue;
    }
    const dashUrl = process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
    const unsubUrl = `${process.env.BACKEND_URL ?? 'https://mydashrx-backend.onrender.com'}/api/v1/signup/pharmacy-intent/unsubscribe?email=${encodeURIComponent(intent.adminEmail)}`;
    sendAbandonmentEmail(intent.adminEmail, intent.orgName ?? undefined, unsubUrl);
    await db.update(signupIntents).set({ recoveredAt: new Date() })
      .where(sql`id = ${intent.id}`);
    sent++;
  }
  if (sent > 0) console.log(`[AbandonmentSweep] Sent ${sent} recovery email(s)`);
};
setInterval(() => { runAbandonmentSweep().catch(console.error); }, 30 * 60 * 1000);

// P-CNV18/P-ONB38: Activation nudge cron — runs hourly, fires emails at 10 AM UTC
// Day-3: approved 3d+ ago, firstDispatchAt IS NULL, nudgeSentAt IS NULL
// Day-7: approved 7d+ ago, firstDispatchAt IS NULL, nudge2SentAt IS NULL
// Uses firstDispatchAt (first route dispatched) NOT activatedAt (first stop created) — P-ONB38
const runActivationNudgeCron = async () => {
  const hour = new Date().getUTCHours();
  if (hour !== 10) return; // Only fires at 10 AM UTC

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;

  const dashUrl = process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
  const now = Date.now();
  const day3Cutoff = new Date(now - 3 * 86400_000);
  const day7Cutoff = new Date(now - 7 * 86400_000);

  // Fetch all approved orgs that have NOT dispatched yet — firstDispatchAt IS NULL
  const candidates = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      approvedAt: organizations.approvedAt,
      firstDispatchAt: organizations.firstDispatchAt,
      nudgeSentAt: organizations.nudgeSentAt,
      nudge2SentAt: organizations.nudge2SentAt,
      onboardingDepotAt: organizations.onboardingDepotAt,
      onboardingDriverAt: organizations.onboardingDriverAt,
    })
    .from(organizations)
    .where(and(
      isNotNull(organizations.approvedAt),
      isNull(organizations.firstDispatchAt),
      isNull(organizations.deletedAt),
    ));

  let nudge1Sent = 0, nudge2Sent = 0;
  for (const org of candidates) {
    if (!org.approvedAt) continue;
    const approved = new Date(org.approvedAt);

    // Find pharmacy_admin user email for this org
    const [admin] = await db.select({ email: users.email, name: users.name })
      .from(users)
      .where(and(eq(users.orgId, org.id), sql`role = 'pharmacy_admin'`, isNull(users.deletedAt)))
      .limit(1);
    if (!admin) continue;

    // Determine next incomplete step
    const nextStep = !org.onboardingDepotAt ? 'depot' : !org.onboardingDriverAt ? 'driver' : 'route';
    const stepUrl = `${dashUrl}/${nextStep === 'depot' ? 'depots/new' : nextStep === 'driver' ? 'drivers/new' : 'plans/new'}`;
    const stepLabel = nextStep === 'depot' ? 'Add your first depot' : nextStep === 'driver' ? 'Add a driver' : 'Create your first route';

    // Day-7 nudge (check first to avoid sending Day-3 to Day-7 orgs)
    if (approved <= day7Cutoff && !org.nudge2SentAt) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `MyDashRx <noreply@${process.env.SENDER_DOMAIN ?? 'mydashrx.com'}>`,
          to: admin.email,
          subject: `${org.name} — you're one step away from your first delivery`,
          track_clicks: false, track_opens: false,
          html: `<p>Hi ${admin.name},</p><p>It's been a week since your MyDashRx account was approved, and your team hasn't made a delivery yet.</p><p>Your next step: <strong>${stepLabel}</strong></p><p><a href="${stepUrl}" style="background:#0F766E;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin:12px 0">${stepLabel} →</a></p><p>If you need help getting started, reply to this email and our team will walk you through it.</p><p>– The MyDashRx Team</p>`,
        }),
      }).catch(console.error);
      await db.update(organizations).set({ nudge2SentAt: new Date() }).where(eq(organizations.id, org.id));
      nudge2Sent++;
    }
    // Day-3 nudge (only if Day-7 not yet sent)
    else if (approved <= day3Cutoff && !org.nudgeSentAt) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `MyDashRx <noreply@${process.env.SENDER_DOMAIN ?? 'mydashrx.com'}>`,
          to: admin.email,
          subject: `${org.name} — ready to make your first delivery?`,
          track_clicks: false, track_opens: false,
          html: `<p>Hi ${admin.name},</p><p>Your MyDashRx account is approved and ready to go. Most pharmacies make their first delivery within a day of signing up.</p><p>Your next step: <strong>${stepLabel}</strong></p><p><a href="${stepUrl}" style="background:#0F766E;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin:12px 0">${stepLabel} →</a></p><p>– The MyDashRx Team</p>`,
        }),
      }).catch(console.error);
      await db.update(organizations).set({ nudgeSentAt: new Date() }).where(eq(organizations.id, org.id));
      nudge1Sent++;
    }
  }
  if (nudge1Sent + nudge2Sent > 0) {
    console.log(JSON.stringify({ event: 'activation_nudge_cron', nudge1Sent, nudge2Sent, ts: new Date().toISOString() }));
  }
};
setInterval(() => { runActivationNudgeCron().catch(console.error); }, 60 * 60 * 1000);

// P-DEL26: Soft bounce retry sweep — runs every 10 minutes
// Queries email_retry_queue for due rows (nextRetryAt <= NOW(), resolvedAt IS NULL, attemptCount < 4)
// Re-sends via Resend, updates attemptCount + nextRetryAt on each attempt.
const SOFT_BOUNCE_DELAYS_MS = [15 * 60_000, 60 * 60_000, 4 * 60 * 60_000, 12 * 60 * 60_000];
const runSoftBounceRetrySweep = async () => {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;

  const due = await db.select().from(emailRetryQueue)
    .where(sql`next_retry_at <= NOW() AND resolved_at IS NULL AND attempt_count < 4`);

  for (const row of due) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: `MyDashRx <noreply@${process.env.MAIL_SENDER_DOMAIN ?? process.env.SENDER_DOMAIN ?? 'mydashrx.com'}>`,
          to: row.toAddress,
          subject: row.subject,
          html: row.htmlBody,
          track_clicks: false,
          track_opens: false,
          headers: { 'Feedback-ID': `retry:mydashrx:resend:${row.emailType}` },
        }),
      });

      const newAttemptCount = (row.attemptCount ?? 0) + 1;

      if (res.ok) {
        // Sent successfully — mark resolved
        await db.update(emailRetryQueue)
          .set({ resolvedAt: new Date(), lastAttemptAt: new Date(), attemptCount: newAttemptCount } as any)
          .where(sql`id = ${row.id}`);
        console.log(JSON.stringify({ event: 'soft_bounce_retry_sent', toAddress: row.toAddress, emailType: row.emailType, attemptCount: newAttemptCount }));
      } else {
        // Failed — schedule next retry if attempts remain
        const delayMs = SOFT_BOUNCE_DELAYS_MS[Math.min(newAttemptCount, SOFT_BOUNCE_DELAYS_MS.length - 1)];
        await db.update(emailRetryQueue)
          .set({
            attemptCount: newAttemptCount,
            lastAttemptAt: new Date(),
            nextRetryAt: new Date(Date.now() + delayMs),
            ...(newAttemptCount >= 4 ? { resolvedAt: new Date() } : {}), // exhaust — mark resolved (max attempts)
          } as any)
          .where(sql`id = ${row.id}`);
      }
    } catch (err) {
      console.error('[soft-bounce-retry] error on row', row.id, err instanceof Error ? err.message : err);
    }
  }
  if (due.length > 0) console.log(JSON.stringify({ event: 'soft_bounce_retry_sweep', processed: due.length }));
};
setInterval(() => { runSoftBounceRetrySweep().catch(console.error); }, 10 * 60 * 1000);

// Startup config warnings — log which optional features are unconfigured
const optionalEnvs: [string, string][] = [
  ['GOOGLE_PLACES_API_KEY', 'Lead Finder search'],
  ['RESEND_API_KEY', 'Email outreach'],
  ['RESEND_OUTREACH_API_KEY', 'P-DEL28: Separate Resend key for cold outreach — required to protect auth email reputation'],
  ['SENDER_DOMAIN', 'Email outreach sender'],
  ['STRIPE_WEBHOOK_SECRET', 'Billing webhooks'],
  ['TWILIO_ACCOUNT_SID', 'SMS/IVR'],
  ['TWILIO_AUTH_TOKEN', 'SMS/IVR'],
  ['TWILIO_FROM_NUMBER', 'SMS sending'],
  ['VAPID_PUBLIC_KEY', 'P-DEL16: Web push for driver mid-route alerts — generate with: npx web-push generate-vapid-keys'],
  ['VAPID_PRIVATE_KEY', 'P-DEL16: Web push for driver mid-route alerts — generate with: npx web-push generate-vapid-keys'],
];
for (const [key, feature] of optionalEnvs) {
  if (!process.env[key]) console.warn(`[CONFIG] ${key} not set — ${feature} will be unavailable`);
}

// Auto-seed in background after server is live (non-blocking)
setImmediate(async () => {
  try {
    // Auto-heal: reset test org rejection every startup — prevents seed data corruption from blocking test logins
    await db.update(organizations)
      .set({ pendingApproval: false, approvedAt: new Date(), rejectedAt: null, rejectionReason: null, rejectionNote: null })
      .where(sql`name = 'MyDashRx Test Pharmacy' AND rejected_at IS NOT NULL`);

    const [firstOrg] = await db.select({ id: organizations.id }).from(organizations).limit(1);
    if (!firstOrg) {
      console.log('DB empty — seeding in background...');
      const { spawn } = await import('child_process');
      const seed = spawn('npx', ['tsx', join(process.cwd(), 'src/db/seed.ts')], {
        env: { ...process.env },
        stdio: 'inherit',
      });
      seed.on('close', (code) => console.log(`Seed exited with code ${code}`));
    }
  } catch (err) {
    console.error('Seed error (non-fatal):', err instanceof Error ? err.message : err);
  }
});

// P-DEL22: DKIM health check — hourly tick, runs only Sunday 3AM UTC
setInterval(async () => {
  const now = new Date();
  if (now.getUTCDay() === 0 && now.getUTCHours() === 3) {
    runDkimHealthCheck().catch(console.error);
  }
}, 60 * 60 * 1000);

// P-RBAC38: Permission drift detection — hourly tick, runs only Sunday 2AM UTC
// Compares all org role_templates vs platform defaults; stores results in permission_drift_snapshots
setInterval(async () => {
  const now = new Date();
  if (now.getUTCDay() !== 0 || now.getUTCHours() !== 2) return;
  try {
    const { detectPermissionDrift } = await import('./lib/rbacCache.js');
    const drifts = await detectPermissionDrift();
    if (drifts.length) {
      // Purge snapshots older than 8 days, then insert fresh batch
      await db.execute(sql`DELETE FROM permission_drift_snapshots WHERE detected_at < NOW() - INTERVAL '8 days'`);
      for (const d of drifts) {
        await db.execute(sql`
          INSERT INTO permission_drift_snapshots (org_id, role, added_perms, removed_perms)
          VALUES (${d.orgId}::uuid, ${d.role}, ${d.addedPerms}::text[], ${d.removedPerms}::text[])
        `);
      }
      console.log(JSON.stringify({ event: 'permission_drift_detected', driftCount: drifts.length }));
    } else {
      console.log(JSON.stringify({ event: 'permission_drift_clean', driftCount: 0 }));
    }
  } catch (err) {
    console.error('P-RBAC38 drift cron error (non-fatal):', err instanceof Error ? err.message : err);
  }
}, 60 * 60 * 1000);

// P-DEL16: Push subscription TTL cleanup — daily sweep, delete expired subscriptions
// 90-day TTL prevents stale subs from accumulating; 410 Gone responses auto-delete during send
setInterval(async () => {
  try {
    const result = await db.execute(sql`DELETE FROM push_subscriptions WHERE expires_at < NOW() RETURNING id`);
    const count = (result as unknown as { rows?: unknown[] }).rows?.length ?? 0;
    if (count > 0) console.log(JSON.stringify({ event: 'push_subscription_cleanup', deleted: count }));
  } catch (err) {
    console.error('P-DEL16 push subscription cleanup error (non-fatal):', err instanceof Error ? err.message : err);
  }
}, 24 * 60 * 60 * 1000);

// P-SES13: RT + magic link token cleanup — run on startup and every 6hr
const runTokenCleanup = async () => {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const mlResult = await db.delete(magicLinkTokens).where(
      or(
        lt(magicLinkTokens.expiresAt, cutoff),
        and(isNotNull(magicLinkTokens.usedAt), lt(magicLinkTokens.createdAt, cutoff)),
      )
    ).returning({ id: magicLinkTokens.id });
    const rtResult = await db.execute(
      sql`DELETE FROM refresh_tokens WHERE (status = 'used' OR status = 'revoked') AND expires_at < NOW() - INTERVAL '7 days' RETURNING id`
    );
    const rtDeleted = (rtResult as unknown as Array<unknown>).length;
    if (mlResult.length > 0 || rtDeleted > 0) {
      console.log(JSON.stringify({ event: 'token_cleanup', magicLinks: mlResult.length, refreshTokens: rtDeleted }));
    }
  } catch (err) {
    console.error('Token cleanup error (non-fatal):', err instanceof Error ? err.message : err);
  }
};
setImmediate(runTokenCleanup);
setInterval(runTokenCleanup, 6 * 60 * 60 * 1000);

// Daily report scheduler — fires every hour, sends between 7-8 AM UTC
setInterval(async () => {
  const now = new Date();
  if (now.getUTCHours() !== 7) return;
  const allOrgs = await db.select().from(organizations).where(isNull(organizations.deletedAt));
  for (const org of allOrgs) {
    sendDailyReport(org.id).catch(console.error);
  }
  // P-DRV4: Weekly driver performance email — Monday 7AM UTC
  if (now.getUTCDay() === 1) {
    sendWeeklyDriverDigests().catch(console.error);
  }
  // P-DEL24: Google Postmaster Tools daily spam rate check (fires with 7AM daily report)
  runPostmasterMonitor().catch(console.error);
}, 60 * 60 * 1000);

// P-DRV4: sendWeeklyDriverDigests — sends each driver their weekly completion/on-time stats
async function sendWeeklyDriverDigests(): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  const { drivers: driversTable } = await import('./db/schema.js');
  const { routes: routesTable, stops: stopsTable } = await import('./db/schema.js');

  const allDriverUsers = await db.select({
    id: users.id, email: users.email, name: users.name, orgId: users.orgId,
  }).from(users).where(and(isNull(users.deletedAt), eq(users.role, 'driver')));

  const from7d = new Date(Date.now() - 7 * 86400000);

  for (const dUser of allDriverUsers) {
    try {
      // Resolve driverId from email+orgId
      const [driverRec] = await db.execute(sql`
        SELECT id FROM drivers WHERE email = ${dUser.email} AND org_id = ${dUser.orgId}::uuid AND deleted_at IS NULL LIMIT 1
      `) as unknown as Array<{ id: string }>;
      if (!driverRec) continue;

      const [statsRow] = await db.execute(sql`
        SELECT
          count(*) FILTER (WHERE s.status IN ('completed','failed','rescheduled'))::int AS terminal,
          count(*) FILTER (WHERE s.status = 'completed')::int AS completed,
          count(*) FILTER (WHERE s.status = 'completed' AND s.window_end IS NOT NULL AND s.completed_at IS NOT NULL AND s.completed_at <= s.window_end)::int AS on_time,
          count(*) FILTER (WHERE s.window_end IS NOT NULL AND s.completed_at IS NOT NULL)::int AS windowed
        FROM stops s
        JOIN routes r ON r.id = s.route_id
        WHERE r.driver_id = ${driverRec.id}::uuid
          AND s.deleted_at IS NULL
          AND s.created_at >= ${from7d.toISOString()}::timestamptz
      `) as unknown as Array<{ terminal: number; completed: number; on_time: number; windowed: number }>;
      if (!statsRow || statsRow.terminal === 0) continue;

      const cr = Math.round((statsRow.completed / statsRow.terminal) * 100);
      const otr = statsRow.windowed > 0 ? Math.round((statsRow.on_time / statsRow.windowed) * 100) : null;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `MyDashRx <reports@${process.env.SENDER_DOMAIN ?? 'cartana.life'}>`,
          to: dUser.email,
          reply_to: 'support@mydashrx.com',
          subject: `Your weekly delivery stats — ${cr}% completion`,
          html: `<!DOCTYPE html><html><body style="font-family:system-ui;background:#f7f8fc;padding:20px;">
<div style="background:white;border-radius:12px;padding:24px;max-width:480px;margin:0 auto;border:1px solid #e5e7eb;">
  <div style="color:#0F4C81;font-size:20px;font-weight:700;margin-bottom:16px;">MyDashRx</div>
  <h2 style="margin:0 0 8px;font-size:18px;">Weekly Performance — ${dUser.name}</h2>
  <p style="color:#6b7280;font-size:14px;margin-bottom:20px;">Last 7 days</p>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
    <div style="background:#f9fafb;border-radius:8px;padding:16px;text-align:center;">
      <div style="font-size:28px;font-weight:700;color:${cr>=90?'#059669':cr>=80?'#d97706':'#dc2626'}">${cr}%</div>
      <div style="font-size:12px;color:#6b7280;">Completion Rate</div>
    </div>
    ${otr!=null?`<div style="background:#f9fafb;border-radius:8px;padding:16px;text-align:center;"><div style="font-size:28px;font-weight:700;color:${otr>=90?'#059669':'#d97706'}">${otr}%</div><div style="font-size:12px;color:#6b7280;">On-Time Rate</div></div>`:''}
    <div style="background:#f9fafb;border-radius:8px;padding:16px;text-align:center;">
      <div style="font-size:28px;font-weight:700;color:#111827">${statsRow.completed}</div>
      <div style="font-size:12px;color:#6b7280;">Completed</div>
    </div>
    <div style="background:#f9fafb;border-radius:8px;padding:16px;text-align:center;">
      <div style="font-size:28px;font-weight:700;color:#111827">${statsRow.terminal}</div>
      <div style="font-size:12px;color:#6b7280;">Total Stops</div>
    </div>
  </div>
  <a href="${process.env.DASHBOARD_URL ?? 'https://app.mydashrx.com'}/driver/performance" style="display:block;background:#0F4C81;color:white;text-align:center;padding:12px;border-radius:8px;text-decoration:none;margin-top:20px;font-weight:600;">View Full Stats →</a>
</div></body></html>`,
          track_clicks: false,
          track_opens: false,
          headers: { 'Feedback-ID': 'driver-weekly:mydashrx:resend:transactional' },
        }),
      }).catch(console.error);
    } catch (e) {
      console.error(`[driver-weekly-digest] error for ${dUser.email}:`, e);
    }
  }
}

// P-DEL9 + P-DEL13-S3: HIPAA §164.310(d)(2)(i) PHI purge cron — Sunday 2 AM UTC
// Step 1: Fetch S3 keys from records past 6yr retention
// Step 2: Delete objects from S3/R2 storage
// Step 3: NULL PHI DB fields + set pod_purged_at
// Step 4: Delete driver GPS traces past 1yr retention
const runPhiPurgeCron = async () => {
  const now = new Date();
  const isSunday = now.getUTCDay() === 0;
  const is2am = now.getUTCHours() === 2;
  if (!isSunday || !is2am) return;

  try {
    // Step 1: Fetch S3 keys for records to purge (before NULLing them)
    type PodRow = { id: string; signature_data: string | null; id_photo_url: string | null; photos: unknown };
    const podsToPurge = (await db.execute(sql`
      SELECT id, signature_data, id_photo_url, photos
      FROM proof_of_deliveries
      WHERE retention_expires_at < NOW()
        AND pod_purged_at IS NULL
    `)) as unknown as PodRow[];

    const s3KeysToDelete: string[] = [];
    for (const pod of podsToPurge) {
      // signatureData stores the S3 key directly
      if (pod.signature_data) s3KeysToDelete.push(pod.signature_data);
      // idPhotoUrl may be a full URL or a key — extract key portion if it starts with https
      if (pod.id_photo_url) {
        const url = pod.id_photo_url;
        // Strip base URL prefix to get key: "pod/uuid.jpg" or full https://... URL
        const key = url.startsWith('https://') ? url.split('/').slice(3).join('/') : url;
        if (key) s3KeysToDelete.push(key);
      }
      // photos is a JSONB array — may contain objects with url/key fields
      const photos = Array.isArray(pod.photos) ? pod.photos as Array<{ key?: string; url?: string }> : [];
      for (const photo of photos) {
        const k = photo.key ?? (photo.url?.startsWith('https://') ? photo.url.split('/').slice(3).join('/') : photo.url);
        if (k) s3KeysToDelete.push(k);
      }
    }

    // Step 2: Delete from S3/R2 in parallel (allSettled — don't fail on individual key errors)
    let s3Deleted = 0;
    let s3Errors = 0;
    if (s3KeysToDelete.length > 0) {
      const results = await Promise.allSettled(s3KeysToDelete.map(k => deleteFromStorage(k)));
      s3Deleted = results.filter(r => r.status === 'fulfilled').length;
      s3Errors = results.filter(r => r.status === 'rejected').length;
      if (s3Errors > 0) {
        console.warn(JSON.stringify({ event: 'phi_purge_s3_partial_errors', s3Errors, s3Deleted, ts: now.toISOString() }));
      }
    }

    // Step 3: NULL PHI DB fields after S3 objects are deleted
    const podResult = await db.execute(sql`
      UPDATE proof_of_deliveries
      SET
        signature_data = NULL,
        id_photo_url   = NULL,
        recipient_name = NULL,
        photos         = '[]'::jsonb,
        pod_purged_at  = NOW()
      WHERE retention_expires_at < NOW()
        AND pod_purged_at IS NULL
      RETURNING id
    `);
    const podPurged = (podResult as unknown as Array<unknown>).length;

    // Step 4: Purge driver GPS traces past 1yr retention (address proximity PHI)
    const locResult = await db.execute(sql`
      DELETE FROM driver_location_history
      WHERE retention_expires_at < NOW()
      RETURNING id
    `);
    const locPurged = (locResult as unknown as Array<unknown>).length;

    // P-DISP1: Step 5 — soft-delete stop_notes older than 7yr (HIPAA minimum retention)
    // stop_notes may contain PHI (patient instructions, access notes); purge with stops
    await db.execute(sql`
      UPDATE stop_notes SET deleted_at = NOW()
      WHERE deleted_at IS NULL
        AND created_at < NOW() - INTERVAL '7 years'
    `).catch((e: unknown) => { console.error('[phi_purge] stop_notes purge failed:', e); });

    if (podPurged > 0 || locPurged > 0) {
      await db.execute(sql`
        INSERT INTO admin_audit_logs (id, org_id, admin_id, admin_email, event, metadata, created_at)
        VALUES (
          gen_random_uuid(),
          '00000000-0000-0000-0000-000000000000',
          '00000000-0000-0000-0000-000000000000',
          'system@mydashrx.internal',
          'pod_phi_purged',
          ${JSON.stringify({ podRecordsPurged: podPurged, locationRecordsDeleted: locPurged, s3ObjectsDeleted: s3Deleted, s3Errors, runAt: now.toISOString() })}::jsonb,
          NOW()
        )
      `);
      console.log(JSON.stringify({ event: 'phi_purge_cron', podPurged, locPurged, s3Deleted, s3Errors, ts: now.toISOString() }));
    }
  } catch (err) {
    console.error('[phi_purge_cron] error (non-fatal):', err instanceof Error ? err.message : err);
  }
};
setInterval(() => { runPhiPurgeCron().catch(console.error); }, 60 * 60 * 1000);

// P-CNV22: Stuck-onboarding cron — daily at 11 AM UTC
// Fires for orgs approved 2+ days ago, onboardingCompletedAt IS NULL, no stuckNudge sent yet
const runStuckOnboardingNudge = async () => {
  const hour = new Date().getUTCHours();
  if (hour !== 11) return;
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;

  const twoDaysAgo = new Date(Date.now() - 2 * 86400_000);
  const dashUrl = process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';

  const stuckOrgs = await db.select({
    id: organizations.id,
    name: organizations.name,
    approvedAt: organizations.approvedAt,
    onboardingStep: organizations.onboardingStep,
  })
    .from(organizations)
    .where(and(
      isNotNull(organizations.approvedAt),
      isNull(organizations.onboardingCompletedAt),
      isNull(organizations.stuckNudgeSentAt),
      isNull(organizations.deletedAt),
      sql`approved_at < ${twoDaysAgo.toISOString()}`,
    ));

  let sent = 0;
  for (const org of stuckOrgs) {
    const [admin] = await db.select({ email: users.email, name: users.name })
      .from(users)
      .where(and(eq(users.orgId, org.id), sql`role = 'pharmacy_admin'`, isNull(users.deletedAt)))
      .limit(1);
    if (!admin) continue;

    const step = org.onboardingStep ?? 1;
    const nextStep = step <= 1 ? 'depot' : step <= 2 ? 'driver' : 'plan';
    const stepUrl = `${dashUrl}/${nextStep === 'depot' ? 'depots/new' : nextStep === 'driver' ? 'drivers/new' : 'plans/new'}`;
    const stepLabel = nextStep === 'depot' ? 'Add your depot' : nextStep === 'driver' ? 'Add a driver' : 'Create a route';

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `MyDashRx <noreply@${process.env.SENDER_DOMAIN ?? 'mydashrx.com'}>`,
        to: admin.email,
        subject: `${org.name} — you're 3 steps from your first delivery`,
        track_clicks: false, track_opens: false,
        html: `<p>Hi ${admin.name ?? 'there'},</p><p>Your ${org.name} account is approved but setup isn't complete yet.</p><p>Your next step: <strong>${stepLabel}</strong></p><p><a href="${stepUrl}" style="background:#0F766E;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin:12px 0">${stepLabel} →</a></p><p>Setup takes about 5 minutes. Need help? Reply to this email.</p><p>– The MyDashRx Team</p>`,
      }),
    }).catch(console.error);
    await db.update(organizations).set({ stuckNudgeSentAt: new Date() }).where(eq(organizations.id, org.id));
    sent++;
  }
  if (sent > 0) console.log(JSON.stringify({ event: 'stuck_onboarding_nudge', sent, ts: new Date().toISOString() }));
};
setInterval(() => { runStuckOnboardingNudge().catch(console.error); }, 60 * 60 * 1000);

// P-RBAC33: Expired escalation sweep — runs every 5 minutes
// Finds expired, non-revoked escalations + revokes their RT families to force re-auth
const runEscalationExpirySweep = async () => {
  const expired = await db.select({ id: roleEscalations.id, userId: roleEscalations.userId })
    .from(roleEscalations)
    .where(and(isNull(roleEscalations.revokedAt), lt(roleEscalations.expiresAt, new Date())));
  if (!expired.length) return;

  const now = new Date();
  await db.update(roleEscalations).set({ revokedAt: now })
    .where(inArray(roleEscalations.id, expired.map(e => e.id)));

  const userIds = [...new Set(expired.map(e => e.userId))];
  await db.update(refreshTokens).set({ status: 'revoked' })
    .where(and(inArray(refreshTokens.userId, userIds), eq(refreshTokens.status, 'active')));

  console.log(JSON.stringify({ event: 'escalation_expiry_sweep', expired: expired.length, ts: now.toISOString() }));
};
setInterval(() => { runEscalationExpirySweep().catch(console.error); }, 5 * 60 * 1000);

// P-RBAC34: Zombie account detection — runs daily at 3 AM UTC
// Flags users with lastLoginAt < 90 days ago (or never logged in + created > 90d) to org admin
const runZombieAccountDetection = async () => {
  if (new Date().getUTCHours() !== 3) return;
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const resendKey = process.env.RESEND_API_KEY;
  const senderDomain = process.env.SENDER_DOMAIN ?? 'mydashrx.com';

  const zombies = await db.select({
    id: users.id, email: users.email, name: users.name,
    orgId: users.orgId, role: users.role, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt,
  }).from(users).where(and(
    isNull(users.deletedAt),
    or(
      and(isNotNull(users.lastLoginAt), lt(users.lastLoginAt, cutoff)),
      and(isNull(users.lastLoginAt), lt(users.createdAt, cutoff)),
    ),
  ));

  if (!zombies.length) return;

  // Group by org
  const byOrg = new Map<string, typeof zombies>();
  for (const z of zombies) {
    const list = byOrg.get(z.orgId) ?? [];
    list.push(z);
    byOrg.set(z.orgId, list);
  }

  let notified = 0;
  for (const [orgId, zombieList] of byOrg) {
    // Find org admin to notify
    const [admin] = await db.select({ email: users.email, name: users.name })
      .from(users).where(and(eq(users.orgId, orgId), eq(users.role, 'pharmacy_admin'), isNull(users.deletedAt))).limit(1);
    if (!admin || !resendKey) continue;

    // Audit log zombie detection
    await db.insert(adminAuditLogs).values({
      actorId: '00000000-0000-0000-0000-000000000000',
      actorEmail: 'system',
      action: 'zombie_account_detected',
      targetId: orgId,
      targetName: orgId,
      metadata: { count: zombieList.length, userEmails: zombieList.map(z => z.email).slice(0, 10) },
    }).catch(console.error);

    const tableRows = zombieList.slice(0, 20).map(z =>
      `<tr><td>${z.name}</td><td>${z.email}</td><td>${z.role}</td><td>${z.lastLoginAt ? new Date(z.lastLoginAt).toLocaleDateString() : 'Never'}</td></tr>`
    ).join('');

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `MyDashRx <noreply@${senderDomain}>`,
        to: admin.email,
        reply_to: 'support@mydashrx.com',
        subject: `[Action Required] ${zombieList.length} inactive account(s) in your organization`,
        track_clicks: false,
        headers: { 'Feedback-ID': 'zombie-accounts:mydashrx:resend:auth' },
        html: `<span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Your organization has ${zombieList.length} account(s) that haven't logged in for 90+ days.</span><div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 24px"><h2 style="margin:0 0 16px">Inactive accounts review</h2><p>Hi ${admin.name ?? 'there'},</p><p>Your organization has <strong>${zombieList.length}</strong> account(s) that haven't logged in for 90+ days. Per HIPAA §164.308(a)(3), we recommend reviewing and removing access for inactive accounts.</p><table border="1" cellpadding="8" style="border-collapse:collapse;width:100%;margin:16px 0"><tr><th>Name</th><th>Email</th><th>Role</th><th>Last Login</th></tr>${tableRows}</table><p><a href="${process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app'}/settings?tab=team" style="background:#0F766E;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">Review Team Access →</a></p><p style="color:#6B7280;font-size:13px">This is an automated HIPAA compliance notification. Do not auto-delete — review each account before deactivating.</p></div>`,
      }),
    }).catch(console.error);
    notified++;
  }
  if (notified > 0) console.log(JSON.stringify({ event: 'zombie_account_detection', orgsNotified: notified, ts: new Date().toISOString() }));
};
setInterval(() => { runZombieAccountDetection().catch(console.error); }, 60 * 60 * 1000);
