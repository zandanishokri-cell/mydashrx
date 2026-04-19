/**
 * P-RBAC24: Declarative permission gate hook.
 * Reads permissions[] from stored user object (embedded in JWT via ROLE_PERMISSIONS).
 *
 * Usage:
 *   const canManageBilling = usePermission('billing:manage');
 *   const canReadAnalytics = usePermission('analytics:read');
 *
 * Replaces ad-hoc role === 'pharmacy_admin' checks across dashboard components.
 * Super admin with permissions=['*'] passes all permission checks.
 */
import { getUser } from '../lib/auth';

export function usePermission(perm: string): boolean {
  const user = getUser();
  if (!user) return false;
  const perms = (user as { permissions?: string[] }).permissions;
  if (!perms?.length) return false;
  if (perms.includes('*')) return true;
  return perms.includes(perm);
}

export function useAnyPermission(...perms: string[]): boolean {
  const user = getUser();
  if (!user) return false;
  const userPerms = (user as { permissions?: string[] }).permissions;
  if (!userPerms?.length) return false;
  if (userPerms.includes('*')) return true;
  return perms.some(p => userPerms.includes(p));
}
