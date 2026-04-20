// P-ONB47: Pending-approval 3-email nurture drip via Resend scheduled send
import { createHash } from 'crypto';
import { db } from '../db/connection.js';
import { organizations } from '../db/schema.js';
import { eq } from 'drizzle-orm';

// P-DEL31: deterministic idempotency key for drip emails
function dripIdempotencyKey(orgId: string, step: number): string {
  return createHash('sha256').update(`${orgId}drip${step}`).digest('hex');
}

const RESEND_URL = 'https://api.resend.com/emails';

function resendKey() {
  return process.env.RESEND_API_KEY ?? '';
}

function senderDomain() {
  return process.env.SENDER_DOMAIN ?? 'mydashrx.com';
}

const DELAYS_MS = [0, 24 * 3600_000, 72 * 3600_000]; // immediate, +24h, +72h

const SUBJECTS = [
  (name: string) => `${name} — your MyDashRx application is under review`,
  () => `While you wait — here's what MyDashRx does for pharmacies like yours`,
  () => `Still reviewing your application — we haven't forgotten you`,
];

const BODIES = [
  (name: string) => `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
    <h2 style="color:#0F4C81;margin:0 0 16px">Application received!</h2>
    <p style="color:#374151;margin:0 0 16px;font-size:15px">Thanks for applying, <strong>${name}</strong>. Our team reviews applications within 24–48 hours. Once approved, you'll get instant access to route optimization, driver dispatch, and patient delivery tracking.</p>
    <p style="color:#374151;font-size:15px">We'll email you the moment you're approved.</p>
  </div>`,
  (_name: string) => `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
    <h2 style="color:#0F4C81;margin:0 0 16px">Still reviewing your application</h2>
    <p style="color:#374151;margin:0 0 16px;font-size:15px">Here's a preview of what's waiting for you:</p>
    <ul style="color:#374151;font-size:14px;padding-left:20px;margin:0 0 24px">
      <li style="margin-bottom:8px"><strong>Smart route planning</strong> — cut delivery time by 30%</li>
      <li style="margin-bottom:8px"><strong>Real-time driver tracking</strong> — know where every delivery is</li>
      <li style="margin-bottom:8px"><strong>Patient notifications</strong> — automated SMS/email on delivery</li>
      <li style="margin-bottom:8px"><strong>HIPAA-compliant</strong> — built for pharmacy from day one</li>
    </ul>
  </div>`,
  (_name: string) => `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
    <h2 style="color:#0F4C81;margin:0 0 16px">We're still reviewing your application</h2>
    <p style="color:#374151;margin:0 0 16px;font-size:15px">If you have questions or want to expedite your review, reply to this email — a team member will respond within 2 hours.</p>
    <p style="color:#374151;font-size:15px">You'll receive an approval confirmation at this address as soon as we're done.</p>
  </div>`,
];

async function sendScheduled(to: string, subject: string, html: string, scheduledAt: Date, iKey?: string): Promise<string> {
  const key = resendKey();
  if (!key) return '';
  const body: Record<string, unknown> = {
    from: `MyDashRx <noreply@${senderDomain()}>`,
    to,
    subject,
    html,
    headers: { 'Feedback-ID': 'onboarding-drip:mydashrx:resend:transactional' },
    track_opens: false,
    track_clicks: false,
  };
  // Only set scheduledAt for future emails (immediate = no scheduledAt)
  if (scheduledAt.getTime() > Date.now() + 30_000) {
    body.scheduledAt = scheduledAt.toISOString();
  }
  const extraHeaders: Record<string, string> = iKey ? { 'Resend-Idempotency-Key': iKey } : {};
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...extraHeaders },
    body: JSON.stringify(body),
  });
  const data = await res.json() as { id?: string };
  return data.id ?? '';
}

export async function triggerPendingApprovalDrip(orgId: string, adminEmail: string, adminName: string): Promise<void> {
  const now = Date.now();
  const ids: string[] = [];
  for (let i = 0; i < DELAYS_MS.length; i++) {
    try {
      const id = await sendScheduled(
        adminEmail,
        SUBJECTS[i](adminName),
        BODIES[i](adminName),
        new Date(now + DELAYS_MS[i]),
        dripIdempotencyKey(orgId, i), // P-DEL31: orgId+dripStep deduplication
      );
      ids.push(id);
    } catch (e) {
      console.error(`[P-ONB47] drip email ${i} failed:`, e);
      ids.push('');
    }
  }
  await db.update(organizations)
    .set({ pendingDripEmailIds: JSON.stringify(ids) })
    .where(eq(organizations.id, orgId));
}

export async function cancelPendingDrip(orgId: string): Promise<void> {
  const [org] = await db.select({ pendingDripEmailIds: organizations.pendingDripEmailIds })
    .from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org?.pendingDripEmailIds) return;
  const key = resendKey();
  if (!key) return;
  let ids: string[] = [];
  try { ids = JSON.parse(org.pendingDripEmailIds as string); } catch { return; }
  await Promise.allSettled(
    ids.filter(Boolean).map(id =>
      fetch(`${RESEND_URL}/${id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
      }).catch(() => {})
    )
  );
  await db.update(organizations).set({ pendingDripEmailIds: null }).where(eq(organizations.id, orgId));
}
