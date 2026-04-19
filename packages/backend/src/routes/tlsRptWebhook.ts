/**
 * P-DEL27: TLS-RPT report ingestion endpoint.
 * Receivers (Google, Yahoo, etc.) POST RFC 8460 JSON reports to rua= address.
 * We receive them here, parse, and store to adminAuditLogs for visibility.
 *
 * DNS record required (add manually — see docs/manual-dns-actions.md):
 *   _smtp._tls.mydashrx.com TXT "v=TLSRPTv1; rua=mailto:tls-rpt@mydashrx.com"
 *
 * The inbound email → webhook bridge (e.g. Resend or SendGrid inbound parse)
 * must be configured to POST the JSON report body to:
 *   POST /api/v1/webhooks/tls-rpt
 */
import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { adminAuditLogs } from '../db/schema.js';
import { parseTlsRptReport, hasFailures } from '../lib/tlsRptParser.js';

export const tlsRptWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.post('/tls-rpt', async (req, reply) => {
    const report = parseTlsRptReport(req.body);
    if (!report) {
      app.log.warn('[tls-rpt] received invalid/unparseable TLS-RPT report body');
      // Return 200 anyway — senders retry on non-2xx; we don't want retry storms for malformed
      return reply.code(200).send({ received: true, parsed: false });
    }

    const failures = hasFailures(report);
    const action = failures ? 'tls_rpt_failure' : 'tls_rpt_clean';

    const totalFailures = report.policies.reduce(
      (sum, p) => sum + p.summary.totalFailureSessionCount, 0
    );
    const totalSuccess = report.policies.reduce(
      (sum, p) => sum + p.summary.totalSuccessfulSessionCount, 0
    );

    const metadata = {
      reportId: report.reportId,
      organizationName: report.organizationName,
      dateRangeStart: report.dateRange.startDatetime,
      dateRangeEnd: report.dateRange.endDatetime,
      totalSuccessful: totalSuccess,
      totalFailures,
      policies: report.policies.map(p => ({
        domain: p.policyDomain,
        type: p.policyType,
        failures: p.summary.totalFailureSessionCount,
        failureDetails: p.failureDetails.slice(0, 10), // cap at 10 to limit metadata size
      })),
    };

    try {
      await db.insert(adminAuditLogs).values({
        actorId: null,
        actorRole: 'system',
        action,
        targetType: 'tls_rpt',
        targetId: report.reportId,
        metadata,
      } as any);
      app.log.info({ action, reportId: report.reportId, totalFailures }, '[tls-rpt] report stored');
    } catch (err) {
      app.log.error({ err }, '[tls-rpt] failed to store report to audit logs');
    }

    return reply.code(200).send({ received: true, parsed: true, failures });
  });
};
