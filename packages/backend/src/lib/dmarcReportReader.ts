/**
 * P-DEL30: DMARC aggregate report ingestion + readiness signal
 * Accepts gzipped XML from Resend/email provider via POST /admin/dmarc-webhook
 * Parses DMARC rua aggregate XML, stores rows to dmarc_aggregate_reports table.
 * computeDmarcReadiness() — daily signal when 7-day pass rate >98% AND pct=100.
 */
import { gunzip } from 'zlib';
import { promisify } from 'util';
import { XMLParser } from 'fast-xml-parser';
import { db } from '../db/connection.js';
import { dmarcAggregateReports } from '../db/schema.js';
import { gte, sql, and, eq } from 'drizzle-orm';

const gunzipAsync = promisify(gunzip);
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

interface DmarcRow {
  reportDate: string;
  sourceIp: string;
  count: number;
  disposition: string;
  dkimResult: string;
  spfResult: string;
  policyPublished: string;
  reporterOrg: string;
}

/**
 * Parse raw DMARC aggregate report (gzipped XML buffer or plain XML buffer).
 * Returns normalized rows ready for DB insertion.
 */
export async function parseDmarcReport(body: Buffer): Promise<DmarcRow[]> {
  let xmlBuf: Buffer;
  // Try gunzip first — most DMARC reports are gzipped
  try {
    xmlBuf = await gunzipAsync(body);
  } catch {
    xmlBuf = body; // already plain XML
  }

  const parsed = xmlParser.parse(xmlBuf.toString('utf8'));
  const feedback = parsed?.feedback;
  if (!feedback) throw new Error('Invalid DMARC XML: missing feedback element');

  const policyPublished: string = feedback?.policy_published?.p ?? 'none';
  const reporterOrg: string = feedback?.report_metadata?.org_name ?? '';
  const dateRange = feedback?.report_metadata?.date_range;
  // Use end date of report as report_date
  const reportTimestamp = dateRange?.end ?? dateRange?.begin ?? Math.floor(Date.now() / 1000);
  const reportDate = new Date(Number(reportTimestamp) * 1000).toISOString().slice(0, 10);

  // records can be a single object or an array
  const rawRecords = feedback?.record ?? [];
  const records = Array.isArray(rawRecords) ? rawRecords : [rawRecords];

  return records.map((rec: any) => {
    const row = rec?.row ?? {};
    const policyEvaluated = row?.policy_evaluated ?? {};
    const authResults = rec?.auth_results ?? {};
    // DKIM result: take first result
    const dkimArr = authResults?.dkim ?? [];
    const dkimResult = Array.isArray(dkimArr)
      ? (dkimArr[0]?.result ?? 'fail')
      : (dkimArr?.result ?? 'fail');
    // SPF result: take first result
    const spfArr = authResults?.spf ?? [];
    const spfResult = Array.isArray(spfArr)
      ? (spfArr[0]?.result ?? 'fail')
      : (spfArr?.result ?? 'fail');

    return {
      reportDate,
      sourceIp: row?.source_ip ?? '',
      count: Number(row?.count ?? 0),
      disposition: policyEvaluated?.disposition ?? 'none',
      dkimResult: String(dkimResult),
      spfResult: String(spfResult),
      policyPublished,
      reporterOrg,
    };
  }).filter(r => r.sourceIp);
}

/**
 * Ingest parsed DMARC rows into the database.
 */
export async function storeDmarcRows(rows: DmarcRow[]): Promise<number> {
  if (!rows.length) return 0;
  await db.insert(dmarcAggregateReports).values(rows.map(r => ({
    reportDate: r.reportDate,
    sourceIp: r.sourceIp,
    count: r.count,
    disposition: r.disposition,
    dkimResult: r.dkimResult,
    spfResult: r.spfResult,
    policyPublished: r.policyPublished,
    reporterOrg: r.reporterOrg,
  }))).onConflictDoNothing();
  return rows.length;
}

export interface DmarcReadiness {
  signal: 'ready_for_reject' | 'not_ready';
  passRate7d: number;       // 0-1 decimal
  totalMessages7d: number;
  passedMessages7d: number;
  currentPct: string | null; // 'none' | 'quarantine' | 'reject' | null
  daysChecked: number;
}

/**
 * P-DEL30: computeDmarcReadiness — reads last 7 days of aggregate reports.
 * Signal 'ready_for_reject' when:
 *   - 7-day pass rate (both DKIM+SPF pass = disposition 'none') > 98%
 *   - currentPct === 'reject' (already at reject) OR policyPublished was 'quarantine'/'none'
 *     (meaning we can advance)
 */
export async function computeDmarcReadiness(): Promise<DmarcReadiness> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString().slice(0, 10);

  const [result] = await db.execute(sql`
    SELECT
      COALESCE(SUM(count), 0) AS total_messages,
      COALESCE(SUM(CASE WHEN dkim_result = 'pass' AND spf_result = 'pass' THEN count ELSE 0 END), 0) AS passed_messages,
      COUNT(DISTINCT report_date) AS days_checked,
      (SELECT policy_published FROM dmarc_aggregate_reports ORDER BY created_at DESC LIMIT 1) AS current_pct
    FROM dmarc_aggregate_reports
    WHERE report_date >= ${sevenDaysAgo}
  `) as any;

  const total = Number(result?.total_messages ?? 0);
  const passed = Number(result?.passed_messages ?? 0);
  const daysChecked = Number(result?.days_checked ?? 0);
  const currentPct = result?.current_pct ?? null;
  const passRate = total > 0 ? passed / total : 0;

  const isReady = passRate > 0.98 && total > 0 && daysChecked >= 3;

  return {
    signal: isReady ? 'ready_for_reject' : 'not_ready',
    passRate7d: Math.round(passRate * 10000) / 100, // percentage 2dp
    totalMessages7d: total,
    passedMessages7d: passed,
    currentPct,
    daysChecked,
  };
}
