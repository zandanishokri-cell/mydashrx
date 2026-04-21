"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLE_REDIRECTS = exports.ROLE_PERMISSIONS = void 0;
exports.getRoleRedirect = getRoleRedirect;
/**
 * P-RBAC24/P-RBAC25: Canonical permission map — single source of truth for all RBAC decisions.
 * HIPAA §164.308(a)(4): documented access authorization policies.
 * Edit here to change permissions; do NOT scatter role checks in routes/components.
 */
exports.ROLE_PERMISSIONS = {
    super_admin: ['*'],
    pharmacy_admin: ['stops:read', 'stops:write', 'analytics:read', 'reports:read', 'drivers:manage', 'billing:manage', 'depots:manage', 'compliance:read', 'automation:manage', 'import:write'],
    dispatcher: ['stops:read', 'stops:write', 'analytics:read', 'reports:read', 'drivers:read', 'import:write'],
    pharmacist: ['stops:read', 'compliance:read', 'reports:read'],
    driver: ['stops:self', 'location:write', 'pod:write'],
};
// OPUS-AUDIT-16: canonical role→landing-page map. One definition, imported by both
// backend (validates `next` params + post-login redirects) and frontend (post-auth nav).
// Adding a new Role must update this map in lockstep — drift was the bug we're fixing.
exports.ROLE_REDIRECTS = {
    super_admin: '/dashboard',
    pharmacy_admin: '/dashboard',
    dispatcher: '/dashboard',
    driver: '/driver/routes',
    pharmacist: '/dashboard/welcome/pharmacist',
};
function getRoleRedirect(role, pendingApproval) {
    if (pendingApproval)
        return '/onboarding/waiting';
    return exports.ROLE_REDIRECTS[role] ?? '/dashboard';
}
