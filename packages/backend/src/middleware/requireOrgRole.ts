import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Role } from '@mydash-rx/shared';

export function requireOrgRole(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try { await req.jwtVerify(); } catch {
      reply.code(401).send({ error: 'Unauthorized' }); return;
    }
    const payload = req.user as { role: Role; orgId: string };
    if (!roles.includes(payload.role)) {
      reply.code(403).send({ error: 'Forbidden' }); return;
    }
    const params = req.params as { orgId?: string };
    if (params.orgId && params.orgId !== payload.orgId && payload.role !== 'super_admin') {
      reply.code(403).send({ error: 'Access denied to this organization' }); return;
    }
  };
}
