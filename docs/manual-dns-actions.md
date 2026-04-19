# MyDashRx — Manual DNS & Environment Actions

All items here require manual action in external dashboards (Cloudflare, Resend, Render, GitHub).
They cannot be automated from the codebase. Complete these before activating P-DEL15 subdomains.

---

## DNS Records (Cloudflare / Registrar)

### DMARC — PHI spoofing protection (P-DMARC-DNS)
```
Type:  TXT
Name:  _dmarc.mydashrx.com
Value: v=DMARC1; p=quarantine; pct=25; rua=mailto:dmarc@mydashrx.com
```
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
Value: v=TLSRPTv1; rua=mailto:dmarc@mydashrx.com
```

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
