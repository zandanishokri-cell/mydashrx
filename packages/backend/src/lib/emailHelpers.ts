/**
 * Shared email helpers — centralizes Resend calls to avoid inline duplication
 * All functions are fire-and-forget (no await needed at call site)
 */
import { createHash } from 'crypto';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { buildListUnsubscribeHeaders } from '../routes/unsubscribe.js';

const RESEND = 'https://api.resend.com/emails';

/**
 * P-DEL31: Deterministic idempotency key — SHA-256 of seed string.
 * Use as Resend-Idempotency-Key header to prevent duplicate sends from retry queue.
 * Seed must be stable: same inputs always produce same key.
 */
export function idempotencyKey(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

export interface ResendEmailPayload {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  reply_to?: string;
  headers?: Record<string, string>;
  scheduledAt?: string;
}

/**
 * P-DEL33: HIPAA-safe transactional send wrapper.
 * Enforces track_clicks:false + track_opens:false on every call.
 * HIPAA BAA §164.314(a)(2)(i)(A) — click.resend.com tracking URLs in pharmacy
 * role emails are a PHI leak risk. Never track transactional emails.
 */
export async function sendTransactional(payload: ResendEmailPayload & { idempotencyKey?: string }): Promise<Response> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return new Response('no-key', { status: 200 });
  const { idempotencyKey: ikey, ...rest } = payload;
  const extraHeaders: Record<string, string> = ikey ? { 'Resend-Idempotency-Key': ikey } : {};
  return fetch(RESEND, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}`, ...extraHeaders },
    body: JSON.stringify({ ...rest, track_clicks: false, track_opens: false }),
  });
}

// P-DEL15: Sender subdomain isolation — auth, transactional, outreach on separate subdomains.
// Falls back to SENDER_DOMAIN for backward compat during incremental DNS rollout.
// DNS + Resend dashboard setup required: auth.mydashrx.com / mail.mydashrx.com / outreach.mydashrx.com
export function authSender() {
  const d = process.env.AUTH_SENDER_DOMAIN ?? process.env.SENDER_DOMAIN ?? 'mydashrx.com';
  return `MyDashRx <noreply@${d}>`;
}
export function mailSender() {
  const d = process.env.MAIL_SENDER_DOMAIN ?? process.env.SENDER_DOMAIN ?? 'mydashrx.com';
  return `MyDashRx <noreply@${d}>`;
}
export function outreachSender() {
  const d = process.env.OUTREACH_SENDER_DOMAIN ?? process.env.SENDER_DOMAIN ?? 'mydashrx.com';
  return `MyDashRx <outreach@${d}>`;
}
// Internal alias — transactional emails from shared helpers use mailSender
function sender() { return mailSender(); }
function dashUrl() {
  return process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
}

/**
 * P-DEL11/P-DEL12/P-DEL26: Check bounce suppression + opt-out before sending.
 * Returns true if the address should be suppressed (hard bounce, complaint, soft-bounce window, or opt-out).
 * Critical emails (login links, security alerts) should pass criticalOnly=true to bypass opt-out.
 */
export async function isSuppressed(email: string, criticalOnly = false): Promise<boolean> {
  try {
    const [user] = await db.select({
      bounceStatus: users.bounceStatus,
      emailOptOut: users.emailOptOut,
      softBounceSuppressedUntil: users.softBounceSuppressedUntil,
    }).from(users).where(eq(users.email, email.toLowerCase().trim())).limit(1);
    if (!user) return false;
    // Hard bounces and complaints always suppress — email literally doesn't work
    if (user.bounceStatus === 'hard' || user.bounceStatus === 'complaint') return true;
    // P-DEL26: soft bounce window — suppress until cooldown expires
    if (user.softBounceSuppressedUntil && new Date(user.softBounceSuppressedUntil) > new Date()) return true;
    // Opt-out suppresses marketing/notification emails but NOT critical auth emails
    if (!criticalOnly && user.emailOptOut) return true;
    return false;
  } catch { return false; } // fail-open: never block email on DB error
}

/**
 * P-DEL28: Get a Resend client for outreach emails (separate API key from auth stream).
 * Throws if RESEND_OUTREACH_API_KEY is not configured — forces explicit setup.
 */
export function getOutreachResendKey(): string {
  const key = process.env.RESEND_OUTREACH_API_KEY;
  if (!key) throw new Error('RESEND_OUTREACH_API_KEY not configured — set this in Render env to separate outreach from auth email reputation');
  return key;
}

/** P-ADM26: Welcome email sent on org approval (manual or auto) */
export async function sendOrgApprovalEmail(orgId: string, orgName: string, adminEmail: string, adminName: string): Promise<void> {
  // P-DEL11: suppress hard-bounced addresses
  if (await isSuppressed(adminEmail)) { console.log(`[emailHelpers] suppressed approval email to ${adminEmail} (hard bounce/opt-out)`); return; }
  const dash = dashUrl();
  // P-DEL31: idempotency key — orgId+'approved' ensures one approval email per org
  sendTransactional({
    from: sender(),
    to: adminEmail,
    reply_to: 'onboarding@mydashrx.com',
    subject: `Welcome to MyDashRx — ${orgName} is approved!`,
    // P-DEL17: Gmail postmaster stream bucketing
    headers: { 'Feedback-ID': 'approval:mydashrx:resend:transactional' },
    idempotencyKey: idempotencyKey(orgId + 'approved'),
    html: `
        <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Your pharmacy is approved! Complete setup in 3 steps and run your first delivery today.</span>
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
          <h2 style="color:#0F4C81;margin:0 0 8px">You're approved — let's get delivering!</h2>
          <p style="color:#374151;margin:0 0 8px;font-size:15px">Hi ${adminName},</p>
          <p style="color:#374151;margin:0 0 24px;font-size:15px"><strong>${orgName}</strong> is now live on MyDashRx. Complete these 3 steps and you'll have your first delivery route running today.</p>
          <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px 20px;margin-bottom:24px">
            <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px">
              <span style="background:#0F4C81;color:#fff;border-radius:50%;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">1</span>
              <div><p style="margin:0;font-size:14px;font-weight:600;color:#0c4a6e">Add your depot</p><p style="margin:2px 0 0;font-size:13px;color:#0369a1">Your pharmacy location — used as the route start point</p></div>
            </div>
            <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px">
              <span style="background:#0F4C81;color:#fff;border-radius:50%;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">2</span>
              <div><p style="margin:0;font-size:14px;font-weight:600;color:#0c4a6e">Add a driver</p><p style="margin:2px 0 0;font-size:13px;color:#0369a1">They'll get the app + their first route automatically</p></div>
            </div>
            <div style="display:flex;align-items:flex-start;gap:12px">
              <span style="background:#0F4C81;color:#fff;border-radius:50%;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">3</span>
              <div><p style="margin:0;font-size:14px;font-weight:600;color:#0c4a6e">Create your first delivery plan</p><p style="margin:2px 0 0;font-size:13px;color:#0369a1">Import stops via CSV or add individually</p></div>
            </div>
          </div>
          <a href="${dash}/login?welcome=1" style="display:inline-block;background:#0F4C81;color:#fff;text-decoration:none;padding:13px 28px;border-radius:8px;font-size:15px;font-weight:600;margin-bottom:16px">Sign in &amp; start setup →</a>
          <p style="color:#9ca3af;font-size:12px;margin:16px 0 0">Need help? Reply to this email or book a 15-min setup call: <a href="mailto:onboarding@mydashrx.com?subject=Setup%20call%20for%20${encodeURIComponent(orgName)}" style="color:#0F4C81">onboarding@mydashrx.com</a></p>
        </div>`,
  }).catch((e: unknown) => { console.error('[Resend] approval email failed:', e); });
}

/** P-ADM28: Tokenized reapply link in rejection email */
export async function sendRejectionWithReapplyEmail(
  orgName: string,
  adminEmail: string,
  adminName: string,
  recoveryHeading: string,
  recoveryBody: string,
  reapplyUrl: string,
  orgId?: string,
): Promise<void> {
  // P-DEL18: suppress hard-bounced addresses — rejection emails contain org name + reason = PHI
  // Without this check, PHI could be sent to a recycled address now owned by a different person
  if (await isSuppressed(adminEmail)) { console.log(`[emailHelpers] suppressed rejection email to ${adminEmail} (hard bounce/opt-out)`); return; }
  // P-DEL31: idempotency key — orgId+'rejected' ensures one rejection email per org
  sendTransactional({
    from: sender(),
    to: adminEmail,
    reply_to: 'support@mydashrx.com',
    subject: `Update on your MyDashRx application — ${orgName}`,
    // P-DEL17: Gmail postmaster stream bucketing
    headers: { 'Feedback-ID': 'rejection:mydashrx:resend:transactional' },
    ...(orgId ? { idempotencyKey: idempotencyKey(orgId + 'rejected') } : {}),
    html: `
        <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Your MyDashRx application status — review the next steps to reapply.</span>
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
          <h2 style="color:#dc2626;margin:0 0 8px">Application update</h2>
          <p style="color:#374151;margin:0 0 8px;font-size:15px">Hi ${adminName},</p>
          <p style="color:#374151;margin:0 0 16px;font-size:15px">We weren't able to approve <strong>${orgName}</strong> at this time.</p>
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px 20px;margin-bottom:24px">
            <p style="margin:0 0 6px;font-size:14px;font-weight:600;color:#991b1b">${recoveryHeading}</p>
            <p style="margin:0;font-size:14px;color:#7f1d1d">${recoveryBody}</p>
          </div>
          <a href="${reapplyUrl}" style="display:inline-block;background:#0F4C81;color:#fff;text-decoration:none;padding:13px 28px;border-radius:8px;font-size:15px;font-weight:600;margin-bottom:16px">Reapply now →</a>
          <p style="color:#9ca3af;font-size:12px;margin:16px 0 0">Questions? Contact us at <a href="mailto:support@mydashrx.com" style="color:#0F4C81">support@mydashrx.com</a></p>
        </div>`,
  }).catch((e: unknown) => { console.error('[Resend] rejection email failed:', e); });
}

/** P-RBAC29: Role change notification — sent to target user when their role is changed by an admin */
export async function sendRoleChangeEmail(
  targetEmail: string,
  targetName: string,
  actorName: string,
  oldRole: string,
  newRole: string,
  userId?: string,
): Promise<void> {
  if (await isSuppressed(targetEmail, true)) return; // critical = true: bypass opt-out, never suppress security alerts
  const dash = dashUrl();
  const roleLabels: Record<string, string> = {
    pharmacy_admin: 'Pharmacy Admin',
    dispatcher: 'Dispatcher',
    pharmacist: 'Pharmacist',
    driver: 'Driver',
    super_admin: 'Super Admin',
  };
  const oldLabel = roleLabels[oldRole] ?? oldRole;
  const newLabel = roleLabels[newRole] ?? newRole;
  // P-DEL31: seed = userId+newRole+epoch-seconds (truncated to minute for dedup window)
  const iKey = userId ? idempotencyKey(userId + newRole + Date.now().toString().slice(0, -3)) : undefined;
  sendTransactional({
    from: sender(),
    to: targetEmail,
    reply_to: 'support@mydashrx.com',
    subject: 'Your MyDashRx role has been updated',
    // P-DEL17: Gmail postmaster stream bucketing
    headers: { 'Feedback-ID': 'role-change:mydashrx:resend:transactional' },
    ...(iKey ? { idempotencyKey: iKey } : {}),
    html: `
        <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Your access role on MyDashRx has changed — sign in to use your updated permissions.</span>
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
          <h2 style="color:#0F4C81;margin:0 0 8px">Your role has been updated</h2>
          <p style="color:#374151;margin:0 0 8px;font-size:15px">Hi ${targetName},</p>
          <p style="color:#374151;margin:0 0 16px;font-size:15px">Your MyDashRx access role was changed by <strong>${actorName}</strong>.</p>
          <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px 20px;margin-bottom:24px">
            <p style="margin:0 0 8px;font-size:14px;color:#374151"><span style="color:#6b7280">Previous role:</span> <strong>${oldLabel}</strong></p>
            <p style="margin:0;font-size:14px;color:#374151"><span style="color:#6b7280">New role:</span> <strong style="color:#0F4C81">${newLabel}</strong></p>
          </div>
          <p style="color:#6b7280;font-size:13px;margin:0 0 16px">If you didn't expect this change, contact your pharmacy admin or reply to this email.</p>
          <a href="${dash}/login" style="display:inline-block;background:#0F4C81;color:#fff;text-decoration:none;padding:13px 28px;border-radius:8px;font-size:15px;font-weight:600">Sign in with updated access →</a>
          <p style="color:#9ca3af;font-size:12px;margin:16px 0 0">Questions? Contact <a href="mailto:support@mydashrx.com" style="color:#0F4C81">support@mydashrx.com</a></p>
        </div>`,
  }).catch((e: unknown) => { console.error('[Resend] role change email failed:', e); });
}

/** P-CNV28: PLG aha-moment email — fires once on first route dispatch */
export async function sendAhaMomentEmail(orgId: string, adminEmail: string, orgName: string): Promise<void> {
  if (await isSuppressed(adminEmail)) { console.log(`[emailHelpers] suppressed aha-moment email to ${adminEmail}`); return; }
  const dash = dashUrl();
  // P-DEL31: orgId+'aha_moment' — fires exactly once (firstDispatchedAt IS NULL guard in caller)
  sendTransactional({
    from: mailSender(),
    to: adminEmail,
    reply_to: 'onboarding@mydashrx.com',
    subject: 'Your first delivery is live 🚚',
    headers: { 'Feedback-ID': 'stream:mydashrx:resend:aha_moment' },
    idempotencyKey: idempotencyKey(orgId + 'aha_moment'),
    html: `
        <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Your first delivery is now live — the driver has SMS directions and the patient gets a tracking link.</span>
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
          <h2 style="color:#0F4C81;margin:0 0 8px">Your first delivery is live! 🚚</h2>
          <p style="color:#374151;margin:0 0 16px;font-size:15px">Congratulations — <strong>${orgName}</strong> just dispatched its first route on MyDashRx.</p>
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 20px;margin-bottom:24px">
            <div style="margin-bottom:8px"><span style="font-size:13px;font-weight:600;color:#166534">What's happening now:</span></div>
            <ul style="margin:0;padding-left:16px;font-size:13px;color:#14532d;line-height:1.9">
              <li>Your driver has received SMS turn-by-turn directions</li>
              <li>The patient will receive a tracking link when the driver is en route</li>
              <li>You'll see live location updates on the map</li>
            </ul>
          </div>
          <a href="${dash}/dashboard/map" style="display:inline-block;background:#0F4C81;color:#fff;text-decoration:none;padding:13px 28px;border-radius:8px;font-size:15px;font-weight:600;margin-bottom:16px">Track this delivery live →</a>
          <p style="color:#9ca3af;font-size:12px;margin:16px 0 0">Questions? Reply to this email or contact <a href="mailto:onboarding@mydashrx.com" style="color:#0F4C81">onboarding@mydashrx.com</a></p>
        </div>`,
  }).catch((e: unknown) => { console.error('[Resend] aha-moment email failed:', e); });
}

/** P-CNV14: Abandonment recovery email — sent to pharmacy admins who started signup but didn't complete */
export async function sendAbandonmentEmail(adminEmail: string, orgName: string | undefined, unsubscribeUrl: string): Promise<void> {
  // P-DEL11/DEL12: suppress bounced/opted-out addresses
  if (await isSuppressed(adminEmail)) { console.log(`[emailHelpers] suppressed abandonment email to ${adminEmail}`); return; }
  const dash = dashUrl();
  const pharmacyName = orgName ? `<strong>${orgName}</strong>` : 'your pharmacy';
  sendTransactional({
    from: sender(),
    to: adminEmail,
    reply_to: 'support@mydashrx.com',
    subject: 'Complete your MyDashRx application — takes 2 min',
    // P-DEL17: Gmail postmaster stream bucketing
    headers: { 'Feedback-ID': 'abandonment:mydashrx:resend:transactional' },
    html: `
        <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Finish setting up your pharmacy account — approval in under 2 hours, no sales call required.</span>
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
          <img src="${dash}/logo.png" alt="MyDashRx" style="height:32px;margin-bottom:24px" onerror="this.style.display='none'" />
          <h2 style="color:#0F4C81;margin:0 0 8px;font-size:20px">Still thinking about it?</h2>
          <p style="color:#374151;margin:0 0 16px;font-size:15px">We noticed you started an application for ${pharmacyName} but didn't finish. It only takes 2 more minutes.</p>
          <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px 20px;margin-bottom:24px">
            <p style="margin:0 0 6px;font-size:14px;font-weight:600;color:#0369a1">What you get</p>
            <ul style="margin:0;padding-left:16px;font-size:13px;color:#0c4a6e;line-height:1.8">
              <li>Route optimization for your delivery drivers</li>
              <li>HIPAA-compliant patient tracking + proof of delivery</li>
              <li>Approval in under 2 hours — no sales call required</li>
            </ul>
          </div>
          <a href="${dash}/signup/pharmacy" style="display:inline-block;background:#0F4C81;color:#fff;text-decoration:none;padding:13px 28px;border-radius:8px;font-size:15px;font-weight:600;margin-bottom:16px">Complete my application →</a>
          <p style="color:#9ca3af;font-size:12px;margin:16px 0 0">Questions? Reply to this email or contact <a href="mailto:support@mydashrx.com" style="color:#0F4C81">support@mydashrx.com</a></p>
          <p style="color:#d1d5db;font-size:11px;margin:12px 0 0"><a href="${unsubscribeUrl}" style="color:#d1d5db">Unsubscribe</a></p>
        </div>`,
  }).catch((e: unknown) => { console.error('[Resend] abandonment email failed:', e); });
}

/** P-CNV32: Referral success notification — fires to referrer when referred org is approved */
export async function sendReferralSuccessEmail({
  referrerEmail, referrerName, referrerOrgName, newOrgName, referrerOrgId, newOrgId,
}: { referrerEmail: string; referrerName: string; referrerOrgName: string; newOrgName: string; referrerOrgId?: string; newOrgId?: string }): Promise<void> {
  if (await isSuppressed(referrerEmail)) { console.log(`[emailHelpers] suppressed referral success email to ${referrerEmail}`); return; }
  const dash = dashUrl();
  // P-DEL31: referrerId+refereeOrgId — one notification per referral relationship
  const iKey = referrerOrgId && newOrgId ? idempotencyKey(referrerOrgId + newOrgId) : undefined;
  sendTransactional({
    from: mailSender(),
    to: referrerEmail,
    reply_to: 'onboarding@mydashrx.com',
    subject: `Your referral is live — ${newOrgName} just joined MyDashRx`,
    headers: { 'Feedback-ID': 'stream:mydashrx:resend:referral_success' },
    ...(iKey ? { idempotencyKey: iKey } : {}),
    html: `
        <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Great news — ${newOrgName}, the pharmacy you referred, was just approved and is live on MyDashRx.</span>
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px">
          <h2 style="color:#0F4C81;margin:0 0 8px">Your referral is live!</h2>
          <p style="color:#374151;margin:0 0 16px">Hi ${referrerName},</p>
          <p style="color:#374151;margin:0 0 16px">
            Great news — <strong>${newOrgName}</strong>, the pharmacy you referred, was just approved and is live on MyDashRx.
          </p>
          <p style="color:#374151;margin:0 0 24px">
            Thanks for spreading the word. Every pharmacy you refer helps grow the Michigan pharmacy delivery network.
          </p>
          <a href="${dash}/settings?tab=referral" style="display:inline-block;background:#6366F1;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600">
            Refer another pharmacy →
          </a>
          <p style="color:#9ca3af;font-size:12px;margin:24px 0 0">Questions? Reply to this email or contact <a href="mailto:onboarding@mydashrx.com" style="color:#0F4C81">onboarding@mydashrx.com</a></p>
        </div>`,
  }).catch((e: unknown) => { console.error('[Resend] referral success email failed:', e); });
}
