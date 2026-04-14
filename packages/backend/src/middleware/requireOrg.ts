import type { FastifyRequest, FastifyReply } from 'fastify';

export async function requireOrg(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const payload = req.user as { orgId: string; role: string };
  const params = req.params as { orgId?: string };
  if (
    params.orgId &&
    params.orgId !== payload.orgId &&
    payload.role !== 'super_admin'
  ) {
    reply.code(403).send({ error: 'Access denied to this organization' });
  }
}
