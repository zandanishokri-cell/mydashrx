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
import { phiFilterHook } from './middleware/phiFilter.js';
import { phiAuditHook } from './middleware/phiAuditHook.js';
import { sendDailyReport } from './services/dailyReport.js';
import { runAutoApproval } from './lib/autoApproval.js';
import { db, client } from './db/connection.js';
import { organizations, magicLinkTokens } from './db/schema.js';
import { isNull, isNotNull, and, or, lt, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

// Run schema migrations synchronously — fast DDL, must complete before routes work
try {
  await migrate(db, { migrationsFolder: join(process.cwd(), 'src/db/migrations') });
  console.log('DB migrations applied');
} catch (err) {
  console.error('Migration warning (non-fatal):', err instanceof Error ? err.message : err);
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

const jwtSecret = process.env.JWT_SECRET ?? 'dev-secret-change-in-prod-only';
await app.register(jwt, {
  secret: jwtSecret,
  sign: { algorithm: 'HS256' },
  verify: { algorithms: ['HS256'] },
});

// P-SES20: HttpOnly cookie support for BFF token pattern
await app.register(cookie, { secret: process.env.JWT_SECRET ?? 'dev-secret-change-in-prod-only' });

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
