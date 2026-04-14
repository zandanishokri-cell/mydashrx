import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Role } from '@mydash-rx/shared';

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      await req.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const payload = req.user as { role: Role };
    if (!roles.includes(payload.role)) {
      reply.code(403).send({ error: 'Forbidden' });
    }
  };
}
