import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { authRoutes } from './routes/auth.js';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: process.env.DASHBOARD_URL ?? true,
  credentials: true,
});

await app.register(jwt, {
  secret: process.env.JWT_SECRET ?? 'dev-secret-change-in-prod',
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
