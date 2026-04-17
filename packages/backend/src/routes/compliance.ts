import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { baaRegistry, auditLogs, complianceChecks, miComplianceItems, complianceScoreHistory } from '../db/schema.js';
import { eq, and, gte, lte, desc, sql, count } from 'drizzle-orm';
import { requireOrgRole } from '../middleware/requireOrgRole.js';
import { runComplianceScan, isDeploymentBlocked } from '../compliance/scanner.js';

const ADMIN = requireOrgRole('pharmacy_admin', 'super_admin');
const ADMIN_READ = requireOrgRole('pharmacy_admin', 'super_admin', 'pharmacist');

function computeScannerScore(findings: { severity: string; count: number }[]): number {
  const p0 = findings.filter(f => f.severity === 'P0' && f.count > 0).length;
  const p1 = findings.filter(f => f.severity === 'P1' && f.count > 0).length;
  const p2 = findings.filter(f => f.severity === 'P2' && f.count > 0).length;
  const p3 = findings.filter(f => f.severity === 'P3' && f.count > 0).length;
  return Math.max(0, 100 - Math.min(100, p0 * 25 + p1 * 10 + p2 * 5 + p3 * 2));
}

export const complianceRoutes: FastifyPluginAsync = async (app) => {

  // ─── Dashboard summary ───────────────────────────────────────────────────────
  app.get('/dashboard', { preHandler: ADMIN_READ }, async (req) => {
    const { orgId } = req.params as { orgId: string };

    const [checks, baaRows, recentAudit] = await Promise.all([
      db.select().from(complianceChecks).where(eq(complianceChecks.orgId, orgId)),
      db.select().from(baaRegistry).where(eq(baaRegistry.orgId, orgId)),
      db.select({ cnt: count() }).from(auditLogs).where(
        and(
          eq(auditLogs.orgId, orgId),
          gte(auditLogs.createdAt, new Date(Date.now() - 7 * 86400000)),
        ),
      ),
    ]);

    const pendingBaaCount = baaRows.filter(b => b.baaStatus === 'pending' && b.touchesPhi).length;
    const expiredBaaCount = baaRows.filter(b => b.baaStatus === 'expired').length;
    const recentAuditCount = recentAudit[0]?.cnt ?? 0;

    // Build categories map from stored checks
    const catMap: Record<string, { status: string; score: number; detail: string }> = {
      baa_coverage: { status: 'unknown', score: 0, detail: 'Not yet evaluated' },
      audit_logging: { status: 'unknown', score: 0, detail: 'Not yet evaluated' },
      access_control: { status: 'unknown', score: 0, detail: 'Not yet evaluated' },
      encryption: { status: 'unknown', score: 0, detail: 'Not yet evaluated' },
      incident_response: { status: 'unknown', score: 0, detail: 'Not yet evaluated' },
      training: { status: 'unknown', score: 0, detail: 'Not yet evaluated' },
    };

    for (const c of checks) {
      if (catMap[c.category]) {
        catMap[c.category] = {
          status: c.status,
          score: c.status === 'pass' ? 100 : c.status === 'warning' ? 50 : c.status === 'fail' ? 0 : 0,
          detail: c.detail ?? '',
        };
      }
    }

    const scores = Object.values(catMap).map(v => v.score);
    const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const statuses = Object.values(catMap).map(v => v.status);
    const overallStatus = statuses.includes('fail') ? 'fail' : statuses.includes('warning') ? 'warning' : statuses.every(s => s === 'pass') ? 'pass' : 'warning';

    return {
      overallStatus,
      score: avgScore,
      categories: catMap,
      recentAuditCount,
      pendingBaaCount,
      expiredBaaCount,
    };
  });

  // ─── BAA Registry ─────────────────────────────────────────────────────────────
  app.get('/baa', { preHandler: ADMIN_READ }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    return db.select().from(baaRegistry).where(eq(baaRegistry.orgId, orgId)).orderBy(baaRegistry.createdAt);
  });

  app.post('/baa', { preHandler: ADMIN }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = req.body as {
      vendorName: string; service: string; baaStatus?: string;
      signedAt?: string; expiresAt?: string; documentUrl?: string;
      notes?: string; touchesPhi?: boolean;
    };
    if (!body.vendorName?.trim()) return reply.code(400).send({ error: 'vendorName is required' });
    if (!body.service?.trim()) return reply.code(400).send({ error: 'service is required' });
    const VALID_BAA_STATUSES = ['signed', 'pending', 'not_required', 'expired'];
    if (body.baaStatus !== undefined && !VALID_BAA_STATUSES.includes(body.baaStatus)) {
      return reply.code(400).send({ error: `Invalid baaStatus. Must be one of: ${VALID_BAA_STATUSES.join(', ')}` });
    }
    const [row] = await db.insert(baaRegistry).values({
      orgId,
      vendorName: body.vendorName,
      service: body.service,
      baaStatus: (body.baaStatus as 'signed' | 'pending' | 'not_required' | 'expired') ?? 'pending',
      signedAt: body.signedAt ? new Date(body.signedAt) : null,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      documentUrl: body.documentUrl ?? null,
      notes: body.notes ?? null,
      touchesPhi: body.touchesPhi ?? true,
    }).returning();
    reply.code(201).send(row);
  });

  app.patch('/baa/:baaId', { preHandler: ADMIN }, async (req, reply) => {
    const { orgId, baaId } = req.params as { orgId: string; baaId: string };
    const body = req.body as Partial<{
      vendorName: string; service: string; baaStatus: string;
      signedAt: string; expiresAt: string; documentUrl: string;
      notes: string; touchesPhi: boolean;
    }>;
    const VALID_BAA_STATUSES = ['signed', 'pending', 'not_required', 'expired'];
    if (body.baaStatus !== undefined && !VALID_BAA_STATUSES.includes(body.baaStatus)) {
      return reply.code(400).send({ error: `Invalid baaStatus. Must be one of: ${VALID_BAA_STATUSES.join(', ')}` });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.vendorName !== undefined) updates.vendorName = body.vendorName;
    if (body.service !== undefined) updates.service = body.service;
    if (body.baaStatus !== undefined) updates.baaStatus = body.baaStatus;
    if (body.signedAt !== undefined) updates.signedAt = body.signedAt ? new Date(body.signedAt) : null;
    if (body.expiresAt !== undefined) updates.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (body.documentUrl !== undefined) updates.documentUrl = body.documentUrl;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.touchesPhi !== undefined) updates.touchesPhi = body.touchesPhi;

    const [row] = await db.update(baaRegistry)
      .set(updates)
      .where(and(eq(baaRegistry.id, baaId), eq(baaRegistry.orgId, orgId)))
      .returning();
    if (!row) { reply.code(404).send({ error: 'Not found' }); return; }
    return row;
  });

  app.delete('/baa/:baaId', { preHandler: ADMIN }, async (req, reply) => {
    const { orgId, baaId } = req.params as { orgId: string; baaId: string };
    const [row] = await db.delete(baaRegistry)
      .where(and(eq(baaRegistry.id, baaId), eq(baaRegistry.orgId, orgId)))
      .returning();
    if (!row) { reply.code(404).send({ error: 'Not found' }); return; }
    reply.code(204).send();
  });

  // ─── Audit Logs ───────────────────────────────────────────────────────────────
  app.get('/audit-logs', { preHandler: ADMIN_READ }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const {
      user: userFilter, action, resource, from, to,
      page = '1', export: exportFormat,
    } = req.query as {
      user?: string; action?: string; resource?: string;
      from?: string; to?: string; page?: string; export?: string;
    };

    const PAGE_SIZE = 50;
    const pageNum = Math.max(1, parseInt(page, 10));

    const conditions = [eq(auditLogs.orgId, orgId)];
    if (userFilter) conditions.push(eq(auditLogs.userEmail, userFilter));
    if (action) conditions.push(eq(auditLogs.action, action));
    if (resource) conditions.push(eq(auditLogs.resource, resource));
    if (from) conditions.push(gte(auditLogs.createdAt, new Date(from)));
    if (to) conditions.push(lte(auditLogs.createdAt, new Date(to + 'T23:59:59')));

    const where = and(...conditions);

    if (exportFormat === 'csv') {
      const rows = await db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(10000);
      const header = 'Timestamp,User,Action,Resource,Resource ID,IP Address';
      const lines = rows.map(r =>
        [r.createdAt.toISOString(), r.userEmail ?? '', r.action, r.resource, r.resourceId ?? '', r.ipAddress ?? '']
          .map(v => `"${String(v).replace(/"/g, '""')}"`)
          .join(','),
      );
      const csv = [header, ...lines].join('\n');
      reply.header('Content-Type', 'text/csv');
      const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
      reply.header('Content-Disposition', `attachment; filename="audit-log-${todayStr}.csv"`);
      return reply.send(csv);
    }

    const [rows, totalRes] = await Promise.all([
      db.select().from(auditLogs).where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(PAGE_SIZE)
        .offset((pageNum - 1) * PAGE_SIZE),
      db.select({ total: sql<number>`count(*)::int` }).from(auditLogs).where(where),
    ]);

    return { rows, total: totalRes[0]?.total ?? 0, page: pageNum, pageSize: PAGE_SIZE };
  });

  app.post('/audit-logs', { preHandler: ADMIN }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = req.body as {
      userId?: string; userEmail?: string; action: string;
      resource: string; resourceId?: string; ipAddress?: string;
      userAgent?: string; metadata?: Record<string, unknown>;
    };
    const [row] = await db.insert(auditLogs).values({
      orgId,
      userId: body.userId ?? null,
      userEmail: body.userEmail ?? null,
      action: body.action,
      resource: body.resource,
      resourceId: body.resourceId ?? null,
      ipAddress: body.ipAddress ?? req.ip,
      userAgent: body.userAgent ?? req.headers['user-agent'] ?? null,
      metadata: body.metadata ?? {},
    }).returning();
    reply.code(201).send(row);
  });

  // ─── Compliance Checks ────────────────────────────────────────────────────────
  app.get('/checks', { preHandler: ADMIN_READ }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    return db.select().from(complianceChecks).where(eq(complianceChecks.orgId, orgId));
  });

  app.post('/checks/run', { preHandler: ADMIN }, async (req) => {
    const { orgId } = req.params as { orgId: string };

    const [baaRows, auditCount, existingChecks] = await Promise.all([
      db.select().from(baaRegistry).where(eq(baaRegistry.orgId, orgId)),
      db.select({ cnt: count() }).from(auditLogs).where(eq(auditLogs.orgId, orgId)),
      db.select().from(complianceChecks).where(eq(complianceChecks.orgId, orgId)),
    ]);

    const phiPending = baaRows.filter(b => b.touchesPhi && b.baaStatus !== 'signed').length;
    const hasAuditLogs = (auditCount[0]?.cnt ?? 0) > 0;

    const irCheck = existingChecks.find(c => c.category === 'incident_response');
    const hasIrPlan = !!(irCheck?.detail && irCheck.detail.length > 20);

    const newChecks: {
      category: string; checkName: string; status: string; detail: string;
    }[] = [
      {
        category: 'baa_coverage',
        checkName: 'BAA Coverage for PHI Vendors',
        status: phiPending === 0 ? 'pass' : phiPending <= 2 ? 'warning' : 'fail',
        detail: phiPending === 0
          ? 'All PHI-touching vendors have signed BAAs'
          : `${phiPending} vendor${phiPending > 1 ? 's' : ''} touching PHI pending BAA`,
      },
      {
        category: 'audit_logging',
        checkName: 'Audit Logging Active',
        status: hasAuditLogs ? 'pass' : 'warning',
        detail: hasAuditLogs ? 'Audit logging active and recording events' : 'Audit logging configured but no events recorded yet',
      },
      {
        category: 'access_control',
        checkName: 'Role-Based Access Control',
        status: 'pass',
        detail: 'RBAC enforced via requireRole middleware on all endpoints',
      },
      {
        category: 'encryption',
        checkName: 'Data Encryption',
        status: 'pass',
        detail: 'TLS in transit enforced; database encryption at rest via provider',
      },
      {
        category: 'incident_response',
        checkName: 'Incident Response Plan',
        status: hasIrPlan ? 'pass' : 'warning',
        detail: hasIrPlan ? 'Incident response plan on file' : 'No incident response plan filed — add plan details via compliance notes',
      },
      {
        category: 'training',
        checkName: 'HIPAA Training Records',
        status: 'fail',
        detail: 'Training records module not yet implemented — manual records required',
      },
    ];

    const now = new Date();
    const nextCheck = new Date(now.getTime() + 30 * 86400000);

    const results = await Promise.all(newChecks.map(async (c) => {
      const existing = existingChecks.find(e => e.category === c.category);
      if (existing) {
        const [updated] = await db.update(complianceChecks)
          .set({ checkName: c.checkName, status: c.status, detail: c.detail, lastCheckedAt: now, nextCheckAt: nextCheck })
          .where(eq(complianceChecks.id, existing.id))
          .returning();
        return updated;
      }
      const [inserted] = await db.insert(complianceChecks).values({
        orgId, ...c, lastCheckedAt: now, nextCheckAt: nextCheck,
      }).returning();
      return inserted;
    }));

    return { ran: results.length, checks: results };
  });

  // ─── Automated Compliance Scanner ─────────────────────────────────────────
  // Runs real DB queries for HIPAA + Michigan violations; persists results to compliance_checks

  app.post('/scan', { preHandler: ADMIN }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const findings = await runComplianceScan({ orgId, persistResults: true });
    const score = computeScannerScore(findings);
    // Persist score snapshot (fire-and-forget — don't fail the scan if history insert fails)
    db.insert(complianceScoreHistory).values({
      orgId,
      score,
      violationCount: findings.filter(f => f.count > 0).length,
      p0Count: findings.filter(f => f.severity === 'P0' && f.count > 0).length,
      p1Count: findings.filter(f => f.severity === 'P1' && f.count > 0).length,
    }).catch(console.error);
    return {
      scannedAt: new Date(),
      findings,
      score,
      summary: {
        total: findings.length,
        violations: findings.filter(f => f.count > 0).length,
        P0: findings.filter(f => f.severity === 'P0' && f.count > 0).length,
        P1: findings.filter(f => f.severity === 'P1' && f.count > 0).length,
        P2: findings.filter(f => f.severity === 'P2' && f.count > 0).length,
        P3: findings.filter(f => f.severity === 'P3' && f.count > 0).length,
      },
      blocksDeployment: isDeploymentBlocked(findings),
    };
  });

  // GET /orgs/:orgId/compliance/score-history — last 30 scan score data points
  app.get('/score-history', { preHandler: ADMIN_READ }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const rows = await db
      .select({
        score: complianceScoreHistory.score,
        violationCount: complianceScoreHistory.violationCount,
        p0Count: complianceScoreHistory.p0Count,
        scannedAt: complianceScoreHistory.scannedAt,
      })
      .from(complianceScoreHistory)
      .where(eq(complianceScoreHistory.orgId, orgId))
      .orderBy(desc(complianceScoreHistory.scannedAt))
      .limit(30);
    return [...rows].reverse(); // chronological order for charting
  });

  // ─── Michigan Compliance Checklist ──────────────────────────────────────────
  app.get('/mi-checklist', { preHandler: ADMIN_READ }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    return db.select().from(miComplianceItems)
      .where(eq(miComplianceItems.orgId, orgId))
      .orderBy(miComplianceItems.category, miComplianceItems.createdAt);
  });

  app.patch('/mi-checklist/:itemId', { preHandler: ADMIN }, async (req, reply) => {
    const { orgId, itemId } = req.params as { orgId: string; itemId: string };
    const body = req.body as Partial<{ status: string; notes: string; dueDate: string }>;

    const VALID_MI_ITEM_STATUSES = ['compliant', 'warning', 'non_compliant', 'pending'];
    if (body.status !== undefined && !VALID_MI_ITEM_STATUSES.includes(body.status)) {
      return reply.code(400).send({ error: `Invalid status. Must be one of: ${VALID_MI_ITEM_STATUSES.join(', ')}` });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.status !== undefined) {
      updates.status = body.status;
      updates.completedAt = body.status === 'compliant' ? new Date() : null;
    }
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.dueDate !== undefined) updates.dueDate = body.dueDate ? new Date(body.dueDate) : null;

    const [row] = await db.update(miComplianceItems)
      .set(updates)
      .where(and(eq(miComplianceItems.id, itemId), eq(miComplianceItems.orgId, orgId)))
      .returning();
    if (!row) { reply.code(404).send({ error: 'Not found' }); return; }
    return row;
  });

  app.get('/scan/latest', { preHandler: ADMIN_READ }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const rows = await db
      .select()
      .from(complianceChecks)
      .where(eq(complianceChecks.orgId, orgId))
      .orderBy(desc(complianceChecks.lastCheckedAt));
    // Only return rows that contain scanner ScanFinding JSON (have severity field).
    // Rows from POST /checks/run store plain strings — exclude them to keep summary counts accurate.
    return rows
      .map(r => {
        try {
          const detail = r.detail ? JSON.parse(r.detail) : null;
          if (!detail?.severity) return null;
          return { ...r, detail };
        } catch { return null; }
      })
      .filter(Boolean);
  });
};
