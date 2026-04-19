/**
 * P-RBAC35: ABAC attribute-based access control policies
 * Applied as preHandler middleware on specific routes.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/connection.js';
import { trustedDevices, stops } from '../db/schema.js';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { createHash } from 'crypto';

// P-RBAC35 Policy 1: requireTrustedDeviceForCOD
// If stop has controlledSubstance: true, require trustTier >= 2 (trusted_devices row exists + not revoked)
// Blocks untrusted devices from completing COD stops (HIPAA access control depth-of-defence)
export async function requireTrustedDeviceForCOD(
  req: FastifyRequest,
  reply: FastifyReply,
  stopId: string,
): Promise<boolean> {
  const [stop] = await db.select({ controlledSubstance: stops.controlledSubstance })
    .from(stops)
    .where(eq(stops.id, stopId))
    .limit(1);

  if (!stop?.controlledSubstance) return true; // non-COD stop — policy not applicable

  const userId = (req.user as { sub: string }).sub;
  const ua = (req.headers['user-agent'] as string | undefined) ?? null;
  const acceptLang = (req.headers['accept-language'] as string | undefined) ?? null;
  const tz = (req.headers['x-timezone'] as string | undefined) ?? null;
  const fingerprint = createHash('sha256').update(`${ua ?? ''}|${acceptLang ?? ''}|${tz ?? ''}`).digest('hex');

  const [trusted] = await db.select({ id: trustedDevices.id })
    .from(trustedDevices)
    .where(and(
      eq(trustedDevices.userId, userId),
      eq(trustedDevices.fingerprint, fingerprint),
      eq(trustedDevices.isRevoked, false),
      gt(trustedDevices.trustedUntil, new Date()),
    ))
    .limit(1);

  if (!trusted) {
    reply.code(403).send({ error: 'Controlled substance stops require a trusted device. Please trust this device first.' });
    return false;
  }
  return true;
}

// P-RBAC35 Policy 2: requireBusinessHoursImpersonation
// Block impersonation sessions outside 06:00-22:00 UTC unless ADMIN_24H_OVERRIDE header is present
export function requireBusinessHoursImpersonation(
  req: FastifyRequest,
  reply: FastifyReply,
): boolean {
  const impersonateHeader = req.headers['x-impersonate-org'];
  if (!impersonateHeader) return true; // not an impersonation request

  const override = req.headers['x-admin-24h-override'];
  if (override === process.env.ADMIN_24H_OVERRIDE_SECRET) return true;

  const utcHour = new Date().getUTCHours();
  if (utcHour < 6 || utcHour >= 22) {
    reply.code(403).send({ error: 'Impersonation only permitted during business hours (06:00-22:00 UTC).' });
    return false;
  }
  return true;
}
