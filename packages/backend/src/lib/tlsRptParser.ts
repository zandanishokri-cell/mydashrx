/**
 * P-DEL27: RFC 8460 TLS Reporting (TLS-RPT) JSON report parser.
 * Receivers send JSON reports to rua= address; we ingest via POST /webhooks/tls-rpt.
 * Extracts policy-domain, failure-details, result-type for audit logging.
 */

export interface TlsRptFailureDetail {
  resultType: string;
  sendingMtaIp?: string;
  receivingMxHostname?: string;
  failureReasonCode?: string;
  additionalInfo?: string;
}

export interface TlsPolicyResult {
  policyDomain: string;
  policyType: string;
  summary: { totalSuccessfulSessionCount: number; totalFailureSessionCount: number };
  failureDetails: TlsRptFailureDetail[];
}

export interface TlsRptReport {
  organizationName: string;
  dateRange: { startDatetime: string; endDatetime: string };
  contactInfo?: string;
  reportId: string;
  policies: TlsPolicyResult[];
}

/** Parse an RFC 8460 TLS-RPT JSON report body. Returns null on invalid input. */
export function parseTlsRptReport(body: unknown): TlsRptReport | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;

  const orgName = typeof b['organization-name'] === 'string' ? b['organization-name'] : '';
  const reportId = typeof b['report-id'] === 'string' ? b['report-id'] : '';
  const dr = b['date-range'] as Record<string, string> | undefined;
  if (!orgName || !reportId || !dr) return null;

  const rawPolicies = Array.isArray(b['policies']) ? b['policies'] : [];
  const policies: TlsPolicyResult[] = rawPolicies.map((p: unknown) => {
    const pol = p as Record<string, unknown>;
    const policyInfo = (pol['policy'] as Record<string, unknown>) ?? {};
    const summary = (pol['summary'] as Record<string, number>) ?? {};
    const rawFailures = Array.isArray(pol['failure-details']) ? pol['failure-details'] : [];
    const failureDetails: TlsRptFailureDetail[] = rawFailures.map((f: unknown) => {
      const fd = f as Record<string, string>;
      return {
        resultType: fd['result-type'] ?? 'unknown',
        sendingMtaIp: fd['sending-mta-ip'],
        receivingMxHostname: fd['receiving-mx-hostname'],
        failureReasonCode: fd['failure-reason-code'],
        additionalInfo: fd['additional-information'],
      };
    });
    return {
      policyDomain: String(policyInfo['policy-domain'] ?? ''),
      policyType: String(policyInfo['policy-type'] ?? 'unknown'),
      summary: {
        totalSuccessfulSessionCount: Number(summary['total-successful-session-count'] ?? 0),
        totalFailureSessionCount: Number(summary['total-failure-session-count'] ?? 0),
      },
      failureDetails,
    };
  });

  return {
    organizationName: orgName,
    reportId,
    dateRange: {
      startDatetime: dr['start-datetime'] ?? '',
      endDatetime: dr['end-datetime'] ?? '',
    },
    contactInfo: typeof b['contact-info'] === 'string' ? b['contact-info'] : undefined,
    policies,
  };
}

/** Returns true if the report contains any MTA-STS or DANE policy failures. */
export function hasFailures(report: TlsRptReport): boolean {
  return report.policies.some(p => p.summary.totalFailureSessionCount > 0);
}
