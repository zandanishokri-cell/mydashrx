export type Role = 'super_admin' | 'pharmacy_admin' | 'dispatcher' | 'driver' | 'pharmacist';

/**
 * P-RBAC24/P-RBAC25: Canonical permission map — single source of truth for all RBAC decisions.
 * HIPAA §164.308(a)(4): documented access authorization policies.
 * Edit here to change permissions; do NOT scatter role checks in routes/components.
 */
export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  super_admin:    ['*'],
  pharmacy_admin: ['stops:read','stops:write','analytics:read','reports:read','drivers:manage','billing:manage','depots:manage','compliance:read','automation:manage','import:write'],
  dispatcher:     ['stops:read','stops:write','analytics:read','reports:read','drivers:read','import:write'],
  pharmacist:     ['stops:read','compliance:read','reports:read'],
  driver:         ['stops:self','location:write','pod:write'],
};

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  orgId: string;
  depotIds: string[];
  permissions?: string[]; // P-RBAC24: derived from ROLE_PERMISSIONS at login
  mustChangePassword?: boolean;
}

export interface JWTPayload {
  sub: string;
  email: string;
  role: Role;
  orgId: string;
  tenantId?: string; // P-RBAC21: explicit tenant claim — always equals orgId, injected by signTokens()
  depotIds: string[];
  permissions?: string[]; // P-RBAC24: canonical permissions derived from ROLE_PERMISSIONS; injected by signTokens()
  mustChangePw?: boolean;
  iat: number;
  exp: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: User;
}

// OPUS-AUDIT-16: canonical role→landing-page map. One definition, imported by both
// backend (validates `next` params + post-login redirects) and frontend (post-auth nav).
// Adding a new Role must update this map in lockstep — drift was the bug we're fixing.
export const ROLE_REDIRECTS: Record<Role, string> = {
  super_admin: '/dashboard',
  pharmacy_admin: '/dashboard',
  dispatcher: '/dashboard',
  driver: '/driver/routes',
  pharmacist: '/dashboard/welcome/pharmacist',
};

export function getRoleRedirect(role?: string, pendingApproval?: boolean): string {
  if (pendingApproval) return '/onboarding/waiting';
  return ROLE_REDIRECTS[role as Role] ?? '/dashboard';
}
