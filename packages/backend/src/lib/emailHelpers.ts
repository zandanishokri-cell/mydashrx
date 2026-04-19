/**
 * Shared email helpers — centralizes Resend calls to avoid inline duplication
 * All functions are fire-and-forget (no await needed at call site)
 */

const RESEND = 'https://api.resend.com/emails';

function sender() {
  return `MyDashRx <noreply@${process.env.SENDER_DOMAIN ?? 'mydashrx.com'}>`;
}
function dashUrl() {
  return process.env.DASHBOARD_URL ?? 'https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app';
}

/** P-ADM26: Welcome email sent on org approval (manual or auto) */
export async function sendOrgApprovalEmail(orgId: string, orgName: string, adminEmail: string, adminName: string): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;
  const dash = dashUrl();
  fetch(RESEND, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
    body: JSON.stringify({
      from: sender(),
      to: adminEmail,
      subject: `Welcome to MyDashRx — ${orgName} is approved!`,
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
