/**
 * P-RBAC17: HIPAA minimum-necessary field filtering (global onSend hook)
 *
 * Fields visible only to elevated roles (super_admin, pharmacy_admin, dispatcher):
 *   - recipientPhone  — full phone; drivers get last-4 masked
 *   - recipientAddress — full address; drivers get street only (no apt/unit)
 *   - customerNotes   — pharmacy-internal notes; super_admin + pharmacy_admin only
 *
 * Additional PHI stripped for drivers:
 *   - rxNumbers, controlledSubstance, requiresRefrigeration, deliveryNotes, codAmount
 */
import type { onSendHookHandler } from 'fastify';
import sjp from 'secure-json-parse';

/** Fields stripped entirely by role */
const STRIP_FIELDS: Record<string, string[]> = {
  driver:     ['rxNumbers', 'controlledSubstance', 'requiresRefrigeration', 'deliveryNotes', 'codAmount', 'customerNotes'],
  dispatcher: ['rxNumbers', 'controlledSubstance', 'customerNotes'],
  pharmacist: ['rxNumbers', 'controlledSubstance'],
};

/** Roles that see full PHI without filtering */
const ELEVATED = new Set(['super_admin', 'pharmacy_admin']);

function maskPhone(phone: string): string {
  if (!phone || phone.length < 4) return '***-***-****';
  return `***-***-${phone.slice(-4)}`;
}

function filterAddress(address: string): string {
  // Return only the street portion (first segment before comma) — hides apartment/unit
  return address.split(',')[0]?.trim() ?? address;
}

function filterFields(obj: unknown, role: string): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => filterFields(item, role));

  const strip = STRIP_FIELDS[role] ?? [];
  const out: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (strip.includes(k)) continue;

    if (k === 'recipientPhone' && role === 'driver') {
      out[k] = maskPhone(v as string);
      continue;
    }

    if (k === 'recipientAddress' && role === 'driver') {
      out[k] = typeof v === 'string' ? filterAddress(v) : v;
      continue;
    }

    out[k] = filterFields(v, role);
  }
  return out;
}

// P-PERF17: PHI field names that require parse+filter. Must stay in sync with STRIP_FIELDS + maskPhone/filterAddress.
const PHI_FIELDS = ['"rxNumbers"', '"recipientPhone"', '"recipientAddress"', '"controlledSubstance"', '"requiresRefrigeration"', '"deliveryNotes"', '"codAmount"', '"customerNotes"'];

export const phiFilterHook: onSendHookHandler<any> = async (req, _reply, payload) => {
  const user = (req as any).user as { role?: string } | undefined;
  const role = user?.role;
  if (!role || ELEVATED.has(role)) return payload; // elevated roles get full PHI
  // P-PERF17: fast-path — skip parse+reserialize if no PHI field names present in payload.
  // Eliminates sjp.parse cost for non-PHI routes (/dashboard/combined, /analytics, /depots, /plans, /drivers).
  const p = payload as string;
  if (typeof p === 'string' && !PHI_FIELDS.some(f => p.includes(f))) return payload;
  try {
    // P-SEC35: secure-json-parse prevents prototype pollution via crafted JSON payloads
    const parsed = sjp.parse(p, undefined, { protoAction: 'error', constructorAction: 'error' });
    return JSON.stringify(filterFields(parsed, role));
  } catch {
    return payload;
  }
};
