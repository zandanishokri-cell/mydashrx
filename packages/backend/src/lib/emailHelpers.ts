/**
 * Shared email helpers — centralizes Resend calls to avoid inline duplication
 * All functions are fire-and-forget (no await needed at call site)
 */
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { buildListUnsubscribeHeaders } from '../routes/unsubscribe.js';

const RESEND = 'https://api.resend.com/emails';

function sender() {
  return `MyDashRx <noreply@${process.env.SENDER_DOMAIN ?? 'mydashrx.com'}>`;
}
function dashUrl() {
  return process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
}

/**
 * P-DEL11/P-DEL12: Check bounce suppression + opt-out before sending.
 * Returns true if the address should be suppressed (hard bounce, complaint, or opt-out).
 * Critical emails (login links, security alerts) should pass criticalOnly=true to bypass opt-out.
 */
export async function isSuppressed(email: string, criticalOnly = false): Promise<boolean> {
  try {
    const [user] = await db.select({ bounceStatus: users.bounceStatus, emailOptOut: users.emailOptOut })
      .from(users).where(eq(users.email, email.toLowerCase().trim())).limit(1);
    if (!user) return false;
    // Hard bounces and complaints always suppress — email literally doesn't work
    if (user.bounceStatus === 'hard' || user.bounceStatus === 'complaint') return true;
    // Opt-out suppresses marketing/notification emails but NOT critical auth emails
    if (!criticalOnly && user.emailOptOut) return true;
    return false;
  } catch { return false; } // fail-open: never block email on DB error
}

/** P-ADM26: Welcome email sent on org approval (manual or auto) */
export async function sendOrgApprovalEmail(orgId: string, orgName: string, adminEmail: string, adminName: string): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;
  // P-DEL11: suppress hard-bounced addresses
  if (await isSuppressed(adminEmail)) { console.log(`[emailHelpers] suppressed approval email to ${adminEmail} (hard bounce/opt-out)`); return; }
  const dash = dashUrl();
  fetch(RESEND, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
    body: JSON.stringify({
      from: sender(),
      to: adminEmail,
      subject: `Welcome to MyDashRx — ${orgName} is approved!`,
      // P-DEL13: suppress click/open tracking — approval links contain org-identifying params
      // that would flow through Resend's CDN clickstream without a BAA confirmation
      track_clicks: false,
      track_opens: false,
      html: `
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
    }),
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
): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;
  fetch(RESEND, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
    body: JSON.stringify({
      from: sender(),
      to: adminEmail,
      subject: `Update on your MyDashRx application — ${orgName}`,
      // P-DEL13: suppress tracking — reapply links in rejection emails must not be scanner-consumed
      track_clicks: false,
      track_opens: false,
      html: `
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
    }),
  }).catch((e: unknown) => { console.error('[Resend] rejection email failed:', e); });
}

/** P-RBAC29: Role change notification — sent to target user when their role is changed by an admin */
export async function sendRoleChangeEmail(
  targetEmail: string,
  targetName: string,
  actorName: string,
  oldRole: string,
  newRole: string,
): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;
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
  fetch(RESEND, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
    body: JSON.stringify({
      from: sender(),
      to: targetEmail,
      subject: 'Your MyDashRx role has been updated',
      track_clicks: false,
      track_opens: false,
      html: `
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
    }),
  }).catch((e: unknown) => { console.error('[Resend] role change email failed:', e); });
}

/** P-CNV14: Abandonment recovery email — sent to pharmacy admins who started signup but didn't complete */
export async function sendAbandonmentEmail(adminEmail: string, orgName: string | undefined, unsubscribeUrl: string): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;
  // P-DEL11/DEL12: suppress bounced/opted-out addresses
  if (await isSuppressed(adminEmail)) { console.log(`[emailHelpers] suppressed abandonment email to ${adminEmail}`); return; }
  const dash = dashUrl();
  const pharmacyName = orgName ? `<strong>${orgName}</strong>` : 'your pharmacy';
  fetch(RESEND, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
    body: JSON.stringify({
      from: sender(),
      to: adminEmail,
      subject: 'Complete your MyDashRx application — takes 2 min',
      // P-DEL13: suppress tracking — signup links must survive corporate email scanners
      track_clicks: false,
      track_opens: false,
      html: `
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
    }),
  }).catch((e: unknown) => { console.error('[Resend] abandonment email failed:', e); });
}
