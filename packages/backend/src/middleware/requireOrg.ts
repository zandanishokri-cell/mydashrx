import type { FastifyRequest, FastifyReply } from 'fastify';

export async function requireOrg(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await req.jwtVerify();
  } catch {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }
  const payload = req.user as { orgId: string; role: string; sub: string };
  const params = req.params as { orgId?: string };

  // P-RBAC31: Super admin impersonation via X-Impersonate-Org header
  // Scopes the effective orgId to the impersonated org for this request only.
  // Audit log tagged with impersonatedOrgId; banner shown in frontend.
  if (payload.role === 'super_admin') {
    const impersonateHeader = req.headers['x-impersonate-org'];
    const impersonatedOrgId = Array.isArray(impersonateHeader)
      ? impersonateHeader[0]
      : impersonateHeader;
    if (impersonatedOrgId) {
      // Scope effective orgId to the impersonated org for downstream handlers
      (req.user as any).effectiveOrgId = impersonatedOrgId;
      (req.user as any).impersonatedOrgId = impersonatedOrgId;
      // Validate route orgId matches impersonated org (prevent header abuse)
      if (params.orgId && params.orgId !== impersonatedOrgId) {
        reply.code(403).send({ error: 'X-Impersonate-Org does not match route orgId' });
        return;
      }
      return; // super_admin + matching impersonation — allow
    }
    return; // super_admin without impersonation — allow all orgs
  }

  if (
    params.orgId &&
    params.orgId !== payload.orgId
  ) {
    reply.code(403).send({ error: 'Access denied to this organization' });
  }
}
