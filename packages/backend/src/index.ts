import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { authRoutes } from './routes/auth.js';
import { organizationRoutes } from './routes/organizations.js';
import { depotRoutes } from './routes/depots.js';
import { driverRoutes } from './routes/drivers.js';
import { planRoutes } from './routes/plans.js';
import { routeRoutes } from './routes/routes.js';
import { stopRoutes } from './routes/stops.js';
import { podRoutes } from './routes/pod.js';
import { trackingRoutes } from './routes/tracking.js';
import { searchRoutes } from './routes/search.js';
import { analyticsRoutes } from './routes/analytics.js';

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
  max: 100,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.ip,
});

await app.register(multipart, {
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

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
await app.register(searchRoutes, { prefix: '/api/v1/orgs/:orgId' });
await app.register(analyticsRoutes, { prefix: '/api/v1/orgs/:orgId/analytics' });

// Health check
app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

// 404 handler
app.setNotFoundHandler((req, reply) => {
  reply.code(404).send({ error: 'Not found' });
});

// Error handler
app.setErrorHandler((err, req, reply) => {
  app.log.error(err);
  reply.code(err.statusCode ?? 500).send({ error: err.message });
});

try {
  await app.listen({ port: Number(process.env.PORT ?? 3001), host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
