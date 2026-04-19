import type { FastifyPluginAsync } from 'fastify';

// Fields stripped by role BEFORE sending response
const PHI_STRIP: Record<string, string[]> = {
  driver:     ['rxNumbers', 'controlledSubstance', 'requiresRefrigeration', 'deliveryNotes', 'codAmount'],
  dispatcher: ['rxNumbers', 'controlledSubstance'],
};

const MASK_PHONE = new Set(['driver']);

function maskPhone(phone: string): string {
  if (!phone || phone.length < 4) return '***';
  return `***-***-${phone.slice(-4)}`;
}

function stripPHI(obj: unknown, role: string): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => stripPHI(item, role));
  const strip = PHI_STRIP[role] ?? [];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (strip.includes(k)) continue;
    if (k === 'recipientPhone' && MASK_PHONE.has(role)) {
      out[k] = maskPhone(v as string);
    } else {
      out[k] = stripPHI(v, role);
    }
  }
  return out;
}

export const phiFilterPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onSend', async (req, _reply, payload) => {
    const user = (req as any).user as { role?: string } | undefined;
    const role = user?.role;
    if (!role || !PHI_STRIP[role]) return payload;
    try {
      const parsed = JSON.parse(payload as string);
      return JSON.stringify(stripPHI(parsed, role));
    } catch {
      return payload;
    }
  });
};
