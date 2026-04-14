import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { findUserByEmail, findUserById, verifyPassword, signTokens } from '../services/auth.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    const { email, password } = parsed.data;

    const user = await findUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      orgId: user.orgId,
      depotIds: user.depotIds as string[],
    };
    const tokens = signTokens(app, payload);
    return reply.send({
      ...tokens,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.orgId },
    });
  });

  app.post('/refresh', async (req, reply) => {
    const body = req.body as { refreshToken?: string };
    if (!body.refreshToken) return reply.code(400).send({ error: 'refreshToken required' });
    try {
      const decoded = app.jwt.verify(body.refreshToken) as { sub: string; type: string };
      if (decoded.type !== 'refresh') throw new Error('wrong token type');
      const user = await findUserById(decoded.sub);
      if (!user) return reply.code(401).send({ error: 'User not found' });
      const tokens = signTokens(app, {
        sub: user.id,
        email: user.email,
        role: user.role,
        orgId: user.orgId,
        depotIds: user.depotIds as string[],
      });
      return reply.send(tokens);
    } catch {
      return reply.code(401).send({ error: 'Invalid refresh token' });
    }
  });

  app.get('/me', async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    const payload = req.user as { sub: string };
    const user = await findUserById(payload.sub);
    if (!user) return reply.code(404).send({ error: 'User not found' });
    return { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.orgId };
  });
};
