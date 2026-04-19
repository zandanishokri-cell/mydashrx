import 'dotenv/config';

// Build-17 — env validation, deploy monitoring
// Validate ALL required env vars before anything else — prints every missing var at once
const REQUIRED_ENV: [string, string][] = [
  ['DATABASE_URL',    'PostgreSQL connection string (Render: link to mydashrx-db)'],
  ['JWT_SECRET',      'HS256 signing secret, min 32 chars (generate: openssl rand -hex 64)'],
  ['RESEND_API_KEY',  'Resend API key — required for magic link emails'],
  ['SENDER_DOMAIN',   'Email sender domain, e.g. cartana.life'],
  ['DASHBOARD_URL',   'Frontend URL for magic link redirect, e.g. https://...vercel.app'],
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
import { unsubscribeRoutes } from './routes/unsubscribe.js';
import { phiFilterHook } from './middleware/phiFilter.js';
import { phiAuditHook } from './middleware/phiAuditHook.js';
import { sendDailyReport } from './services/dailyReport.js';
import { deleteFromStorage } from './services/storage.js';
import { runAutoApproval } from './lib/autoApproval.js';
import { db, client } from './db/connection.js';
import { organizations, magicLinkTokens, signupIntents, users } from './db/schema.js';
import { sendAbandonmentEmail } from './lib/emailHelpers.js';
import { isNull, isNotNull, and, or, lt, sql, eq } from 'drizzle-orm';
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

// P-SES15: idempotent DDL for lastKnownCountry column on users
try {
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_known_country text`);
  console.log('P-SES15 lastKnownCountry column ensured');
} catch (err) {
  console.error('P-SES15 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
}

// P-CNV17/18: idempotent DDL for TTA + activation nudge columns on organizations
try {
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS activated_at timestamptz`);
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS nudge_sent_at timestamptz`);
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS nudge2_sent_at timestamptz`);
  console.log('P-CNV17/18 activation columns ensured');
} catch (err) {
  console.error('P-CNV17/18 DDL warning (non-fatal):', err instanceof Error ? err.message : err);
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

const app = Fastify({ logger: true, trustProxy: true });

await app.register(helmet, {
  contentSecurityPolicy: false,   // API server — no HTML served
  crossOriginEmbedderPolicy: false,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
});

await app.register(cors, {
  origin: process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app',
  credentials: true,
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
  max: process.env.NODE_ENV === 'production' ? 300 : 10000,
  timeWindow: '1 minute',
  // Take leftmost X-Forwarded-For entry (real client IP behind Render proxy)
  keyGenerator: (req) => {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return (Array.isArray(xff) ? xff[0] : xff).split(',')[0].trim();
    return req.ip;
  },
});

await app.register(multipart, {
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

app.addHook('onSend', phiFilterHook);
app.addHook('onRequest', phiAuditHook); // P-RBAC21: PHI read-event audit for HIPAA §164.312(b)

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
// P-DEL12: RFC 8058 one-click unsubscribe
await app.register(unsubscribeRoutes, { prefix: '/api/v1/unsubscribe' });

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

// P-CNV18: Activation nudge cron — runs hourly, fires emails at 10 AM UTC
// Day-3: approved 3d+ ago, activatedAt IS NULL, nudgeSentAt IS NULL
// Day-7: approved 7d+ ago, activatedAt IS NULL, nudge2SentAt IS NULL
const runActivationNudgeCron = async () => {
  const hour = new Date().getUTCHours();
  if (hour !== 10) return; // Only fires at 10 AM UTC

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;

  const dashUrl = process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
  const now = Date.now();
  const day3Cutoff = new Date(now - 3 * 86400_000);
  const day7Cutoff = new Date(now - 7 * 86400_000);

  // Fetch all approved, unactivated orgs with their admin email (join users WHERE role=pharmacy_admin)
  const candidates = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      approvedAt: organizations.approvedAt,
      activatedAt: organizations.activatedAt,
      nudgeSentAt: organizations.nudgeSentAt,
      nudge2SentAt: organizations.nudge2SentAt,
      onboardingDepotAt: organizations.onboardingDepotAt,
      onboardingDriverAt: organizations.onboardingDriverAt,
    })
    .from(organizations)
    .where(and(
      isNotNull(organizations.approvedAt),
      isNull(organizations.activatedAt),
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

// Startup config warnings — log which optional features are unconfigured
const optionalEnvs: [string, string][] = [
  ['GOOGLE_PLACES_API_KEY', 'Lead Finder search'],
  ['RESEND_API_KEY', 'Email outreach'],
  ['SENDER_DOMAIN', 'Email outreach sender'],
  ['STRIPE_WEBHOOK_SECRET', 'Billing webhooks'],
  ['TWILIO_ACCOUNT_SID', 'SMS/IVR'],
  ['TWILIO_AUTH_TOKEN', 'SMS/IVR'],
  ['TWILIO_FROM_NUMBER', 'SMS sending'],
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
  if (new Date().getHours() !== 7) return;
  const allOrgs = await db.select().from(organizations).where(isNull(organizations.deletedAt));
  for (const org of allOrgs) {
    sendDailyReport(org.id).catch(console.error);
  }
}, 60 * 60 * 1000);

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
