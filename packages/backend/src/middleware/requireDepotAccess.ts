import type { FastifyRequest, FastifyReply } from 'fastify';

const DEPOT_EXEMPT = new Set(['super_admin', 'pharmacy_admin']);

/**
 * P-RBAC20: Depot-scoped access guard for dispatchers.
 * Exempt: super_admin, pharmacy_admin (full org access).
 * Reads depotId from params, query, or body — if present and not in user.depotIds → 403.
 * If no depotId in request, passes through (route not depot-specific).
 */
export function requireDepotAccess(depotParamKey = 'depotId') {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = req.user as { role: string; depotIds?: string[]; orgId: string; sub?: string; email?: string };
    if (DEPOT_EXEMPT.has(user.role)) return;
    const depotId =
      (req.params as Record<string, string>)[depotParamKey] ??
      (req.query as Record<string, string>)[depotParamKey] ??
      (req.body as Record<string, string> | null)?.[depotParamKey];
    if (!depotId) return; // route not depot-specific — pass through
    if (!user.depotIds?.includes(depotId)) {
      console.warn(JSON.stringify({
        event: 'permission_denied', rule: 'requireDepotAccess',
        reason: 'depot_not_in_scope', role: user.role,
        userId: user.sub, orgId: user.orgId, email: user.email,
        depotId, method: req.method, url: req.url, ip: req.ip,
        ts: new Date().toISOString(),
      }));
      reply.code(403).send({ error: 'Access denied to this depot' });
    }
  };
}
