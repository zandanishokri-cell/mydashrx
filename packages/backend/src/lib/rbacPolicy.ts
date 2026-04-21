/**
 * P-RBAC25: Canonical RBAC policy for MyDashRx.
 * HIPAA §164.308(a)(4): documented access authorization policies.
 *
 * This is the single source of truth for which roles access which resources.
 * Edit this file to change permissions — do NOT scatter requireOrgRole() calls
 * in routes without consulting this table.
 *
 * Pharmacist access rationale:
 * - stops:read INCLUDED — pharmacists must be able to answer "where is my patient's order?"
 *   Compliance routes already grant pharmacist ADMIN_READ; stop status read is consistent.
 * - analytics:read EXCLUDED — aggregate KPIs are not minimum-necessary for the pharmacist role.
 *   Pharmacists see individual stop status; org-wide performance is pharmacy_admin domain.
 * - reports:read INCLUDED — regulatory compliance reports (DEA, MI Board of Pharmacy) are
 *   within pharmacist scope per Michigan Pharmacy Practice Act.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { getOrgPermissions } from './rbacCache.js';

export const ROUTE_POLICY = {
  // Delivery stops
  'stops:read':    ['super_admin', 'pharmacy_admin', 'dispatcher', 'pharmacist'],
  'stops:write':   ['super_admin', 'pharmacy_admin', 'dispatcher'],
  'stops:self':    ['driver'],

  // Analytics & reports
  'analytics:read': ['super_admin', 'pharmacy_admin', 'dispatcher'],
  'reports:read':   ['super_admin', 'pharmacy_admin', 'dispatcher', 'pharmacist'],

  // Drivers
  'drivers:read':   ['super_admin', 'pharmacy_admin', 'dispatcher'],
  'drivers:manage': ['super_admin', 'pharmacy_admin'],
  'drivers:self':   ['driver'],

  // Billing
  'billing:manage': ['super_admin', 'pharmacy_admin'],

  // Compliance
  'compliance:read':  ['super_admin', 'pharmacy_admin', 'pharmacist'],
  'compliance:write': ['super_admin', 'pharmacy_admin'],

  // Depots
  'depots:manage': ['super_admin', 'pharmacy_admin'],

  // Automation & import
  'automation:manage': ['super_admin', 'pharmacy_admin', 'dispatcher'],
  'import:write':      ['super_admin', 'pharmacy_admin', 'dispatcher'],

  // POD & location (driver self-only)
  'pod:write':      ['driver'],
  'location:write': ['driver'],
} as const;

export type Permission = keyof typeof ROUTE_POLICY;

/**
 * Middleware factory using the canonical ROUTE_POLICY.
 * Replaces ad-hoc requireOrgRole() calls for permission enforcement.
 * Includes structured denial log for HIPAA §164.312 audit trail.
 */
export function requirePermission(perm: Permission) {
  // P-RBAC32: fallback to static policy for unauthenticated fast-fail check
  const staticAllowed = new Set<string>(ROUTE_POLICY[perm] as readonly string[]);
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try { await req.jwtVerify(); } catch {
      reply.code(401).send({ error: 'Unauthorized' }); return;
    }
    const user = req.user as { role: string; orgId?: string; mustChangePw?: boolean; sub?: string; email?: string };

    // P-RBAC32: check org-specific permissions first, fall back to static policy
    let allowed = staticAllowed.has(user.role);
    if (user.orgId) {
      try {
        const orgPerms = await getOrgPermissions(user.orgId, user.role);
        // If org has a custom template, use it; otherwise static check already computed above.
        // Wildcard '*' (super_admin) grants every permission — without this branch, specific
        // perm checks like 'stops:read' return false for ['*'] and super_admin gets 403.
        if (orgPerms.length > 0) allowed = orgPerms.includes('*') || orgPerms.includes(perm);
      } catch { /* non-blocking — static policy remains in effect */ }
    }

    if (!allowed) {
      console.warn(JSON.stringify({
        event: 'permission_denied', rule: `requirePermission(${perm})`,
        reason: 'not_in_policy', role: user.role,
        userId: user.sub, orgId: user.orgId, email: user.email,
        method: req.method, url: req.url, ip: req.ip,
        ts: new Date().toISOString(),
      }));
      reply.code(403).send({ error: 'Forbidden' }); return;
    }
    if (user.mustChangePw) {
      reply.code(403).send({ error: 'Password change required', mustChangePassword: true }); return;
    }
  };
}
