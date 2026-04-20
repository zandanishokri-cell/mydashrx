"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLE_PERMISSIONS = void 0;
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
