/**
 * P-RBAC17: HIPAA minimum-necessary field-level filtering.
 * Strips PHI fields from stop/route responses based on the caller's role.
 * Only roles with clinical or dispatch authority see full PHI.
 * HIPAA §164.502(b) minimum-necessary standard.
 */

/** Roles that may see full PHI on stop records */
const PHI_ALLOWED_ROLES = new Set(['super_admin', 'pharmacy_admin', 'dispatcher']);

/** Fields visible to drivers and other limited roles */
const DRIVER_VISIBLE_STOP_FIELDS = new Set([
  'id', 'routeId', 'orgId', 'status', 'address', 'lat', 'lng',
  'recipientName',         // first name only — see filterDriverStopName()
  'sequenceNumber', 'unit',
  'requiresSignature', 'requiresPhoto', 'requiresAgeVerification',
  'requiresRefrigeration', 'controlledSubstance',
  'packageCount', 'windowStart', 'windowEnd',
  'deliveryNotes',         // operational notes (not clinical Rx info)
  'trackingToken',
  'arrivedAt', 'completedAt', 'failedAt', 'rescheduledAt',
  'podPhotoUrl', 'podSignatureUrl',
  'approachNotifiedAt', 'completionNotifiedAt',
  'createdAt', 'deletedAt',
]);

/** Redact everything except first name for driver — reduces PII exposure */
function maskRecipientName(fullName: string | null | undefined): string {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  return parts[0] ?? '';          // first name only
}

/**
 * Filter a stop record to the minimum fields allowed for `role`.
 * Returns a new object — never mutates input.
 */
export function filterStopForRole<T extends Record<string, unknown>>(stop: T, role: string): Partial<T> {
  if (PHI_ALLOWED_ROLES.has(role)) return stop;  // full PHI for privileged roles

  // Driver (and any future limited role): strip PHI, mask recipient name
  const filtered: Record<string, unknown> = {};
  for (const key of Object.keys(stop)) {
    if (DRIVER_VISIBLE_STOP_FIELDS.has(key)) {
      filtered[key] = key === 'recipientName'
        ? maskRecipientName(stop[key] as string)
        : stop[key];
    }
  }
  return filtered as Partial<T>;
}

/**
 * Filter an array of stops for the given role.
 */
export function filterStopsForRole<T extends Record<string, unknown>>(stops: T[], role: string): Partial<T>[] {
  if (PHI_ALLOWED_ROLES.has(role)) return stops;
  return stops.map(s => filterStopForRole(s, role));
}
