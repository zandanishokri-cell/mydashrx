import 'dotenv/config';

// Surface startup errors clearly before anything else runs
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
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { authRoutes } from './routes/auth.js';
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
import { sendDailyReport } from './services/dailyReport.js';
import { db, client } from './db/connection.js';
import { organizations } from './db/schema.js';
import { isNull } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Run DB migrations + auto-seed on startup
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  await migrate(db, { migrationsFolder: join(__dirname, 'db/migrations') });
  console.log('DB migrations applied');
} catch (err) {
  console.error('Migration warning (non-fatal):', err instanceof Error ? err.message : err);
}

// Auto-seed if DB is empty
try {
  const [firstOrg] = await db.select({ id: organizations.id }).from(organizations).limit(1);
  if (!firstOrg) {
    console.log('DB empty — running seed...');
    const { execSync } = await import('child_process');
    execSync('npx tsx ' + join(__dirname, '../src/db/seed.ts'), {
      env: { ...process.env },
      stdio: 'inherit',
    });
  }
} catch (err) {
  console.error('Seed warning (non-fatal):', err instanceof Error ? err.message : err);
}

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: process.env.DASHBOARD_URL ?? true,
  credentials: true,
});

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET environment variable is required in production');
}
await app.register(jwt, {
  secret: jwtSecret ?? 'dev-secret-change-in-prod-only',
});

await app.register(rateLimit, {
  max: process.env.NODE_ENV === 'production' ? 300 : 10000,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.ip,
});

await app.register(multipart, {
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
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

// Daily report scheduler — fires every hour, sends between 7-8 AM UTC
setInterval(async () => {
  if (new Date().getHours() !== 7) return;
  const allOrgs = await db.select().from(organizations).where(isNull(organizations.deletedAt));
  for (const org of allOrgs) {
    sendDailyReport(org.id).catch(console.error);
  }
}, 60 * 60 * 1000);
