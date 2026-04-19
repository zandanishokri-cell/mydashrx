# MyDashRx — Manual DNS & Environment Actions

All items here require manual action in external dashboards (Cloudflare, Resend, Render, GitHub).
They cannot be automated from the codebase. Complete these before activating P-DEL15 subdomains.

---

## DNS Records (Cloudflare / Registrar)

### DMARC — PHI spoofing protection (P-DMARC-DNS / P-DEL25)

**Staged escalation plan — do NOT jump stages:**

#### Week 1 (deploy now — current target)
```
Type:  TXT
Name:  _dmarc.mydashrx.com
Value: v=DMARC1; p=quarantine; pct=25; rua=mailto:dmarc@mydashrx.com
```
Starts quarantining 25% of spoofed email. Leaves 75% delivering — safe to deploy before verifying clean Postmaster data.

#### Week 2 (after clean Google Postmaster data — spam rate <0.08% for 7 days)
```
Type:  TXT
Name:  _dmarc.mydashrx.com
Value: v=DMARC1; p=quarantine; pct=100; rua=mailto:dmarc@mydashrx.com
```
Full quarantine. No legitimate mail should be affected if SPF + DKIM are correctly configured.

#### Week 6 (after stable pct=100 quarantine — no legitimate mail loss for 4+ weeks)
```
Type:  TXT
Name:  _dmarc.mydashrx.com
Value: v=DMARC1; p=reject; pct=100; rua=mailto:dmarc@mydashrx.com
```
Full reject. **Required prerequisite for BIMI logo display (P-DEL20).** Providers will reject unauthenticated mail outright.

**Notes:**
- `p=quarantine pct=25` is safe even before subdomain warm-up (P-DEL15) — only 25% of unauthenticated mail is affected
- Monitor `dmarc@mydashrx.com` inbox for aggregate reports — look for legitimate sources appearing as failures before escalating
- `p=reject` is the prerequisite for BIMI (DigiCert VMC/CMC cert + DNS TXT record, see P-DEL20 section below)
- Current `pct=25` leaves 75% of spoofed emails delivering — escalate to `pct=100` as soon as Postmaster confirms clean spam rates

**Status:** PENDING — closes HIPAA §164.312(d) PHI spoofing gap.

---

### MTA-STS — Inbound TLS enforcement (P-DEL19)
Two records required:

```
Type:  TXT
Name:  _mta-sts.mydashrx.com
Value: v=STSv1; id=20260420
```

```
Type:  TXT
Name:  _smtp._tls.mydashrx.com
Value: v=TLSRPTv1; rua=mailto:tls-rpt@mydashrx.com
```

**TLS-RPT ingestion setup (P-DEL27):**
- Configure your inbound email bridge (Resend, SendGrid, or Cloudflare Email Routing) to forward email arriving at `tls-rpt@mydashrx.com` as JSON to:
  `POST https://mydashrx-backend.onrender.com/api/v1/webhooks/tls-rpt`
- The endpoint expects the RFC 8460 JSON report body in the POST request
- Reports are stored to `admin_audit_logs` as `tls_rpt_failure` or `tls_rpt_clean` events
- TLS Delivery Health card visible in Platform Admin dashboard
- After 14 consecutive days of `tls_rpt_clean` reports: upgrade `mta-sts.txt` mode from `testing` → `enforce` (edit `packages/dashboard/public/.well-known/mta-sts.txt`)

Also requires a subdomain `mta-sts.mydashrx.com` serving the static policy file at:
`https://mta-sts.mydashrx.com/.well-known/mta-sts.txt`

The file is already in the repo at `packages/dashboard/public/.well-known/mta-sts.txt`.
Deploy the dashboard to a subdomain or configure a redirect.

**Status:** PENDING — closes HIPAA §164.312(e)(2)(ii) inbound TLS gap.

---

### Resend Sender Subdomain Setup (P-DEL15)
Three subdomains must be verified in the Resend dashboard before DNS activation:

| Subdomain | Purpose | Env Var |
|---|---|---|
| `auth.mydashrx.com` | Magic links + security alerts | `AUTH_SENDER_DOMAIN` |
| `mail.mydashrx.com` | Transactional (approvals, invites) | `MAIL_SENDER_DOMAIN` |
| `outreach.mydashrx.com` | Lead finder outreach | `OUTREACH_SENDER_DOMAIN` |

For each subdomain, Resend will provide SPF + DKIM DNS records to add.

**Status:** PENDING — subdomain warm-up caps (P-DEL21) are already active and will block sends if daily limits are exceeded.

---

### BIMI — Brand logo in Gmail/Yahoo (P-DEL20)
```
Type:  TXT
Name:  default._bimi.mydashrx.com
Value: v=BIMI1; l=https://mydashrx.com/bimi-logo.svg; a=<CMC_CERT_URL>
```

**Requirements:**
- DMARC must be at `p=quarantine` or `p=reject` with `pct=100` first
- DigiCert Verified Mark Certificate (VMC/CMC) required for `a=` field — approx. $1,099/yr
- Logo file is in `packages/dashboard/public/bimi-logo.svg` (placeholder — replace with official logo before activating)

**Status:** PENDING — logo asset in place, CMC certificate purchase required.

---

## Environment Variables (Render Dashboard)

| Variable | Value / How to generate | Required by |
|---|---|---|
| `WEBAUTHN_RP_ID` | `mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app` | P-ML18 passkeys |
| `WEBAUTHN_ORIGIN` | `https://mydashrx-dashboard-ai-receptionist-ivr-system.vercel.app` | P-ML18 passkeys |
| `PHI_ENCRYPTION_KEY` | `openssl rand -hex 32` | P-SEC40 — **CRITICAL: server won't start without this** |
| `AUTH_SENDER_DOMAIN` | `auth.mydashrx.com` (after Resend subdomain verified) | P-DEL15 |
| `MAIL_SENDER_DOMAIN` | `mail.mydashrx.com` (after Resend subdomain verified) | P-DEL15 |
| `OUTREACH_SENDER_DOMAIN` | `outreach.mydashrx.com` (after Resend subdomain verified) | P-DEL15 + P-DEL21 |
| `RESEND_WEBHOOK_SECRET` | From Resend dashboard → Webhooks (starts with `whsec_`) | P-DEL11 bounce tracking |
| `RESEND_OUTREACH_API_KEY` | **REQUIRED** — separate Resend API key created for outreach-only use. Create a second API key in the Resend dashboard (e.g., "mydashrx-outreach") and set here. Keeps cold outreach spam complaints isolated from auth email reputation. Without this, lead finder outreach will return 503. | P-DEL28 outreach key separation |
| `GOOGLE_POSTMASTER_SA_JSON` | Service account JSON (raw or base64-encoded) — see setup below | P-DEL24 spam rate monitoring |

---

## Google Postmaster Tools Setup (P-DEL24)

**Required for spam rate monitoring — ~30min one-time setup:**

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → Create or select project
2. Enable **Gmail Postmaster Tools API**: APIs & Services → Enable APIs → search "Gmail Postmaster Tools API" → Enable
3. Create a **Service Account**: IAM & Admin → Service Accounts → Create
   - Name: `mydashrx-postmaster`
   - Role: None needed at project level (Postmaster Tools uses domain-level access)
4. Download JSON key: Service Account → Keys → Add Key → JSON → Download
5. Go to [Google Postmaster Tools](https://postmaster.google.com/) → Add each sender domain
6. Verify each domain ownership (DNS TXT record provided by Postmaster Tools)
7. Grant service account access: Postmaster Tools → domain → Settings → Add user → paste service account email
8. Encode JSON key for Render: `base64 -i service-account-key.json | tr -d '\n'`
9. Set `GOOGLE_POSTMASTER_SA_JSON` in Render dashboard with the base64 output

**Thresholds (P-DEL24):**
- `≥ 0.08%` spam rate → warn (logged as `postmaster_spam_rate_alert` severity=warn)
- `≥ 0.15%` spam rate → critical (logged as `postmaster_spam_rate_alert` severity=critical)
- Gmail hard block threshold: `0.30%` — our alerts fire well before this

---

## GitHub Secrets

| Secret | Value | Purpose |
|---|---|---|
| `SNYK_TOKEN` | From app.snyk.io → Account Settings → API Tokens | P-SEC41 security scanning CI |

---

## Activation Order

1. Set `PHI_ENCRYPTION_KEY` in Render → redeploy
2. Set up Resend subdomains → get DNS records → add to Cloudflare
3. Set `AUTH_SENDER_DOMAIN`, `MAIL_SENDER_DOMAIN`, `OUTREACH_SENDER_DOMAIN` in Render
4. Add DMARC record to Cloudflare
5. Add MTA-STS records + configure `mta-sts.mydashrx.com` subdomain
6. Add Snyk token to GitHub secrets
7. After DMARC reaches `p=reject` + pct=100 → pursue BIMI VMC
