import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Role } from '@mydash-rx/shared';

// P-RBAC18: structured permission denial log for HIPAA §164.312 audit trail
function logDenial(req: FastifyRequest, rule: string, reason: string, role?: string): void {
  const payload = (req.user ?? {}) as { sub?: string; orgId?: string; email?: string };
  console.warn(JSON.stringify({
    event: 'permission_denied',
    rule,
    reason,
    role,
    userId: payload.sub,
    orgId: payload.orgId,
    email: payload.email,
    method: req.method,
    url: req.url,
    ip: req.ip,
    ts: new Date().toISOString(),
  }));
}

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      await req.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    // P-RBAC33: use escalatedRole from JWT if present and active (injected by signTokens on JIT escalation)
    const payload = req.user as { role: Role; orgId?: string; mustChangePw?: boolean; escalatedRole?: string; escalationExpiresAt?: string };
    const effectiveRole = (payload.escalatedRole ?? payload.role) as Role;
    if (!roles.includes(effectiveRole)) {
      logDenial(req, `requireRole(${roles.join(',')})`, 'insufficient_role', effectiveRole);
      reply.code(403).send({ error: 'Forbidden' });
      return;
    }
    // P-RBAC13: cross-tenant bypass guard — super_admin exempt
    const params = req.params as { orgId?: string };
    if (params.orgId && params.orgId !== payload.orgId && payload.role !== 'super_admin') {
      logDenial(req, 'cross_org_access', 'org_mismatch', payload.role);
      reply.code(403).send({ error: 'Access denied to this organization' });
      return;
    }
    if (payload.mustChangePw) {
      reply.code(403).send({ error: 'Password change required', mustChangePassword: true });
      return;
    }
  };
}
