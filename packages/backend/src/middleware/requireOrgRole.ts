import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Role } from '@mydash-rx/shared';

// P-RBAC18: structured denial log for HIPAA §164.312 audit trail
function logDenial(req: FastifyRequest, rule: string, reason: string, role?: string): void {
  const payload = (req.user ?? {}) as { sub?: string; orgId?: string; email?: string };
  console.warn(JSON.stringify({
    event: 'permission_denied', rule, reason, role,
    userId: payload.sub, orgId: payload.orgId, email: payload.email,
    method: req.method, url: req.url, ip: req.ip, ts: new Date().toISOString(),
  }));
}

// P-RBAC12: HIPAA minimum-necessary — delivery write ops restricted to admin+dispatcher only
export function requireDeliveryWrite() {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try { await req.jwtVerify(); } catch {
      reply.code(401).send({ error: 'Unauthorized' }); return;
    }
    const payload = req.user as { role: Role; orgId?: string; mustChangePw?: boolean };
    const writeRoles: Role[] = ['pharmacy_admin', 'dispatcher', 'super_admin'];
    if (!writeRoles.includes(payload.role)) {
      reply.code(403).send({ error: 'Write access restricted to pharmacy admins and dispatchers' }); return;
    }
    if (payload.mustChangePw) {
      reply.code(403).send({ error: 'Password change required', mustChangePassword: true }); return;
    }
  };
}

export function requireOrgRole(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try { await req.jwtVerify(); } catch {
      reply.code(401).send({ error: 'Unauthorized' }); return;
    }
    const payload = req.user as { role: Role; orgId: string; mustChangePw?: boolean };
    if (!roles.includes(payload.role)) {
      logDenial(req, `requireOrgRole(${roles.join(',')})`, 'insufficient_role', payload.role);
      reply.code(403).send({ error: 'Forbidden' }); return;
    }
    const params = req.params as { orgId?: string };
    if (params.orgId && params.orgId !== payload.orgId && payload.role !== 'super_admin') {
      logDenial(req, 'cross_org_access', 'org_mismatch', payload.role);
      reply.code(403).send({ error: 'Access denied to this organization' }); return;
    }
    if (payload.mustChangePw) {
      reply.code(403).send({ error: 'Password change required', mustChangePassword: true }); return;
    }
  };
}
