// P-DEL22: DKIM health check — weekly Sunday 3AM UTC
// Uses built-in Node dns.resolveTxt() — no extra deps
// Verifies resend._domainkey.{domain} TXT record resolves for all 3 sender domains
import { promises as dns } from 'dns';
import { db } from '../db/connection.js';
import { adminAuditLogs } from '../db/schema.js';

const SELECTOR = 'resend'; // Resend's DKIM selector

function getSenderDomains(): string[] {
  const base = process.env.SENDER_DOMAIN;
  const domains = [
    process.env.AUTH_SENDER_DOMAIN ?? base,
    process.env.MAIL_SENDER_DOMAIN ?? base,
    process.env.OUTREACH_SENDER_DOMAIN ?? base,
  ].filter((d): d is string => Boolean(d));
  return [...new Set(domains)]; // deduplicate if all fallback to SENDER_DOMAIN
}

async function checkDomain(domain: string): Promise<{ ok: boolean; record?: string; error?: string }> {
  const lookup = `${SELECTOR}._domainkey.${domain}`;
  try {
    const txts = await dns.resolveTxt(lookup);
    // resolveTxt returns string[][] — join each chunk array
    const records = txts.map(chunks => chunks.join(''));
    const dkimRecord = records.find(r => r.includes('v=DKIM1') || r.includes('k=rsa') || r.includes('p='));
    if (!dkimRecord) {
      return { ok: false, error: `No DKIM1 record found at ${lookup} (got ${records.length} TXT record(s))` };
    }
    return { ok: true, record: dkimRecord.slice(0, 120) };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `DNS lookup failed for ${lookup}: ${msg}` };
  }
}

export async function runDkimHealthCheck(): Promise<void> {
  const domains = getSenderDomains();
  if (!domains.length) {
    console.warn('[DKIM] No sender domains configured — skipping DKIM health check');
    return;
  }

  const results = await Promise.all(domains.map(async d => ({ domain: d, ...(await checkDomain(d)) })));

  for (const r of results) {
    if (r.ok) {
      // Log pass silently to adminAuditLogs for HIPAA §164.312(d) continuity evidence
      db.insert(adminAuditLogs).values({
        action: 'dkim_health_check_passed',
        actorId: 'system' as unknown as string,
        actorEmail: 'system',
        targetId: r.domain,
        targetName: r.domain,
        metadata: { domain: r.domain, record: r.record ?? null },
      }).catch(() => {});
      console.log(JSON.stringify({ event: 'dkim_health_check_passed', domain: r.domain }));
    } else {
      console.error(`[DKIM ALERT] dkim_health_check_failed — domain=${r.domain} error=${r.error}`);
      db.insert(adminAuditLogs).values({
        action: 'dkim_health_check_failed',
        actorId: 'system' as unknown as string,
        actorEmail: 'system',
        targetId: r.domain,
        targetName: r.domain,
        metadata: { domain: r.domain, error: r.error ?? null },
      }).catch(() => {});
    }
  }
}
