/**
 * P-RBAC32: 60s in-memory cache for org-specific role permission templates.
 * Org-specific template wins over platform default (orgId=null).
 * Falls back to static ROLE_PERMISSIONS from shared package if no DB template found.
 */
import { db } from '../db/connection.js';
import { roleTemplates } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { ROLE_PERMISSIONS } from '@mydash-rx/shared';

type CacheEntry = { permissions: string[]; expiresAt: number };
const _cache = new Map<string, CacheEntry>();
const TTL = 60_000;

const key = (orgId: string | null, role: string) => `${orgId ?? '__platform__'}:${role}`;

export async function getOrgPermissions(orgId: string | null, role: string): Promise<string[]> {
  const k = key(orgId, role);
  const cached = _cache.get(k);
  if (cached && cached.expiresAt > Date.now()) return cached.permissions;

  // Load platform default + org override
  const rows = await db.select({ orgId: roleTemplates.orgId, permissions: roleTemplates.permissions })
    .from(roleTemplates)
    .where(eq(roleTemplates.role, role));

  const platform = rows.find(r => r.orgId === null);
  const orgOverride = orgId ? rows.find(r => r.orgId === orgId) : undefined;

  const permissions: string[] = orgOverride?.permissions
    ?? platform?.permissions
    ?? (ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS] as string[] | undefined)
    ?? [];

  _cache.set(k, { permissions, expiresAt: Date.now() + TTL });
  return permissions;
}

export function invalidateOrgRole(orgId: string | null, role: string): void {
  _cache.delete(key(orgId, role));
}

export function invalidateOrg(orgId: string): void {
  for (const k of _cache.keys()) {
    if (k.startsWith(`${orgId}:`)) _cache.delete(k);
  }
}

/** Seed platform defaults from static ROLE_PERMISSIONS — idempotent ON CONFLICT DO NOTHING */
export async function seedPlatformDefaults(): Promise<void> {
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
    // Use partial unique index on (role) WHERE org_id IS NULL — see index rt_platform_role_uniq
    await db.execute(sql`
      INSERT INTO role_templates (id, org_id, role, permissions, is_default, created_at, updated_at)
      VALUES (gen_random_uuid(), NULL, ${role}, ${JSON.stringify(perms)}::jsonb, true, NOW(), NOW())
      ON CONFLICT (role) WHERE org_id IS NULL DO NOTHING
    `).catch(() => {
      // Index may not exist yet on first boot — best-effort seed, never blocks startup
    });
  }
}

/** List all templates (platform + org-specific) — for admin UI */
export async function listTemplates(orgId?: string) {
  const rows = await db.select().from(roleTemplates);
  return orgId ? rows.filter(r => r.orgId === null || r.orgId === orgId) : rows;
}

/** Upsert an org-specific template */
export async function upsertTemplate(orgId: string | null, role: string, permissions: string[]) {
  if (orgId === null) {
    // Platform default — use partial unique index on (role) WHERE org_id IS NULL
    await db.execute(sql`
      INSERT INTO role_templates (id, org_id, role, permissions, is_default, created_at, updated_at)
      VALUES (gen_random_uuid(), NULL, ${role}, ${JSON.stringify(permissions)}::jsonb, true, NOW(), NOW())
      ON CONFLICT (role) WHERE org_id IS NULL DO UPDATE SET permissions = EXCLUDED.permissions, updated_at = NOW()
    `);
  } else {
    // Org-specific override
    await db.execute(sql`
      INSERT INTO role_templates (id, org_id, role, permissions, is_default, created_at, updated_at)
      VALUES (gen_random_uuid(), ${orgId}, ${role}, ${JSON.stringify(permissions)}::jsonb, false, NOW(), NOW())
      ON CONFLICT (org_id, role) WHERE org_id IS NOT NULL DO UPDATE SET permissions = EXCLUDED.permissions, updated_at = NOW()
    `);
    invalidateOrg(orgId);
  }
  invalidateOrgRole(orgId, role);
}
