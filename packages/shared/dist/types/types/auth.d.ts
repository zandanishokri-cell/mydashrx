export type Role = 'super_admin' | 'pharmacy_admin' | 'dispatcher' | 'driver' | 'pharmacist';
/**
 * P-RBAC24/P-RBAC25: Canonical permission map — single source of truth for all RBAC decisions.
 * HIPAA §164.308(a)(4): documented access authorization policies.
 * Edit here to change permissions; do NOT scatter role checks in routes/components.
 */
export declare const ROLE_PERMISSIONS: Record<Role, string[]>;
export interface User {
    id: string;
    email: string;
    name: string;
    role: Role;
    orgId: string;
    depotIds: string[];
    permissions?: string[];
    mustChangePassword?: boolean;
}
export interface JWTPayload {
    sub: string;
    email: string;
    role: Role;
    orgId: string;
    tenantId?: string;
    depotIds: string[];
    permissions?: string[];
    mustChangePw?: boolean;
    iat: number;
    exp: number;
}
export interface AuthTokens {
    accessToken: string;
    refreshToken: string;
    user: User;
}
export declare const ROLE_REDIRECTS: Record<Role, string>;
export declare function getRoleRedirect(role?: string, pendingApproval?: boolean): string;
