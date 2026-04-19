// P-DEL24: Google Postmaster Tools spam rate monitoring
// Fetches gmailpostmastertools v1 trafficStats per sender domain daily
// Thresholds: >=0.08% warn, >=0.15% critical (Gmail hard block at 0.30%)
// Requires GOOGLE_POSTMASTER_SA_JSON env var (service account JSON, base64 or raw)
import { google } from 'googleapis';
import { db } from '../db/connection.js';
import { adminAuditLogs } from '../db/schema.js';

const WARN_THRESHOLD = 0.0008;     // 0.08%
const CRITICAL_THRESHOLD = 0.0015; // 0.15%

function getSenderDomains(): string[] {
  const base = process.env.SENDER_DOMAIN;
  return [...new Set([
    process.env.AUTH_SENDER_DOMAIN ?? base,
    process.env.MAIL_SENDER_DOMAIN ?? base,
    process.env.OUTREACH_SENDER_DOMAIN ?? base,
  ].filter((d): d is string => Boolean(d)))];
}

function getAuth() {
  const raw = process.env.GOOGLE_POSTMASTER_SA_JSON;
  if (!raw) return null;
  try {
    const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString();
    const creds = JSON.parse(json);
    return new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/postmaster.readonly'],
    });
  } catch {
    console.error('[PostmasterMonitor] Failed to parse GOOGLE_POSTMASTER_SA_JSON');
    return null;
  }
}

function todayDateStr(): string {
  // Postmaster date format: YYYYMMDD
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

export async function runPostmasterMonitor(): Promise<void> {
  const auth = getAuth();
  if (!auth) {
    console.warn('[PostmasterMonitor] GOOGLE_POSTMASTER_SA_JSON not set — skipping');
    return;
  }

  const domains = getSenderDomains();
  if (!domains.length) return;

  const postmaster = google.gmailpostmastertools({ version: 'v1', auth });
  const dateStr = todayDateStr();

  for (const domain of domains) {
    try {
      const res = await postmaster.domains.trafficStats.get({
        name: `domains/${domain}/trafficStats/${dateStr}`,
      });

      const spamRate = res.data?.spammyFeedbackLoops?.[0]?.spamRatio
        ?? res.data?.inboundEncryptionRatio // fallback
        ?? null;

      // Postmaster returns spamRatio as a number 0-1
      const rate = typeof spamRate === 'number' ? spamRate : null;
      if (rate === null) {
        console.log(JSON.stringify({ event: 'postmaster_no_data', domain, date: dateStr }));
        continue;
      }

      const pct = (rate * 100).toFixed(4);
      let severity: 'ok' | 'warn' | 'critical' = 'ok';
      if (rate >= CRITICAL_THRESHOLD) severity = 'critical';
      else if (rate >= WARN_THRESHOLD) severity = 'warn';

      if (severity !== 'ok') {
        console.error(`[PostmasterMonitor] postmaster_spam_rate_alert domain=${domain} rate=${pct}% severity=${severity}`);
      } else {
        console.log(JSON.stringify({ event: 'postmaster_spam_rate_ok', domain, rate: pct, date: dateStr }));
      }

      // Log to adminAuditLogs regardless of severity (enables frontend card to read latest)
      db.insert(adminAuditLogs).values({
        action: severity !== 'ok' ? 'postmaster_spam_rate_alert' : 'postmaster_spam_rate_ok',
        actorId: 'system' as unknown as string,
        actorEmail: 'system',
        targetId: domain,
        targetName: domain,
        metadata: { domain, rate: pct, severity, date: dateStr },
      }).catch(() => {});

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // 404 = no data yet for this date (domain not activated or too early)
      if (msg.includes('404') || msg.includes('not found')) {
        console.log(JSON.stringify({ event: 'postmaster_no_data', domain, date: dateStr, reason: 'no traffic stats yet' }));
      } else {
        console.error(`[PostmasterMonitor] fetch failed domain=${domain}: ${msg}`);
      }
    }
  }
}
