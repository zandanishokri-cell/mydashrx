import type { FastifyRequest } from 'fastify';
import { db } from '../db/connection.js';
import { auditLogs } from '../db/schema.js';

/**
 * P-RBAC21: PHI read-event audit logging — HIPAA §164.312(b).
 * Fires on every GET to routes containing PHI (stops, drivers, pod, reports, tracking).
 * Fire-and-forget — never awaited, never blocks request.
 */
const PHI_PATTERNS = [/\/stops/, /\/drivers/, /\/pod/, /\/reports/, /\/track/];

export async function phiAuditHook(req: FastifyRequest): Promise<void> {
  if (req.method !== 'GET') return;
  if (!PHI_PATTERNS.some(p => p.test(req.url))) return;
  const user = (req as any).user as { sub?: string; orgId?: string; email?: string } | undefined;
  if (!user?.orgId) return; // unauthenticated — let auth middleware handle it
  db.insert(auditLogs).values({
    orgId: user.orgId,
    userId: user.sub ?? undefined,
    userEmail: user.email ?? 'unknown',
    action: `${req.method}:${req.url.split('?')[0]}`,
    resource: 'phi_read',
    resourceId: (req.params as Record<string, string>)?.id ?? null,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'] ?? null,
    metadata: {},
  }).catch(e => console.error('[phi-audit] write failed', e.message));
}
