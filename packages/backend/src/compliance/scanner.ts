import { db } from '../db/connection.js';
import {
  stops, proofOfDeliveries, baaRegistry, auditLogs, organizations,
  drivers, routes, plans, recurringDeliveries, complianceChecks, miComplianceItems,
} from '../db/schema.js';
import { eq, and, isNull, isNotNull, lt, gt, ne, or, count, sql, inArray, notInArray } from 'drizzle-orm';

export type Severity = 'P0' | 'P1' | 'P2' | 'P3';

export interface ComplianceFinding {
  orgId: string;
  severity: Severity;
  category: 'hipaa' | 'michigan';
  checkName: string;
  description: string;
  count: number;
  legalRef: string;
  recommendation: string;
  resourceIds: string[];
  blocksDeployment: boolean;
}

const in30Days = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const ago7Days = () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

// ─── HIPAA Checks ─────────────────────────────────────────────────────────────

async function hipaaChecks(orgId: string): Promise<ComplianceFinding[]> {
  const findings: ComplianceFinding[] = [];

  // P0: CS stops completed without requiresAgeVerification=true
  const csNoAgeVerify = await db
    .select({ id: stops.id })
    .from(stops)
    .where(and(
      eq(stops.orgId, orgId),
      eq(stops.controlledSubstance, true),
      eq(stops.status, 'completed'),
      eq(stops.requiresAgeVerification, false),
      isNull(stops.deletedAt),
    ));
  if (csNoAgeVerify.length > 0) findings.push({
    orgId, severity: 'P0', category: 'hipaa',
    checkName: 'hipaa_cs_no_age_verify',
    description: `${csNoAgeVerify.length} completed controlled substance stop(s) did not require age verification`,
    count: csNoAgeVerify.length, legalRef: '45 CFR §164.312 / R 338.3162',
    recommendation: 'Set requiresAgeVerification=true on all controlled substance stops before dispatch',
    resourceIds: csNoAgeVerify.map(s => s.id), blocksDeployment: true,
  });

  // P0: CS stops completed without id_verified in POD
  const csNoPodIdVerify = await db
    .select({ id: stops.id })
    .from(stops)
    .leftJoin(proofOfDeliveries, eq(proofOfDeliveries.stopId, stops.id))
    .where(and(
      eq(stops.orgId, orgId),
      eq(stops.controlledSubstance, true),
      eq(stops.status, 'completed'),
      isNull(stops.deletedAt),
      or(isNull(proofOfDeliveries.id), eq(proofOfDeliveries.idVerified, false)),
    ));
  if (csNoPodIdVerify.length > 0) findings.push({
    orgId, severity: 'P0', category: 'hipaa',
    checkName: 'hipaa_cs_no_pod_id_verify',
    description: `${csNoPodIdVerify.length} completed controlled substance delivery(ies) lack verified ID in proof of delivery`,
    count: csNoPodIdVerify.length, legalRef: '45 CFR §164.312(d)',
    recommendation: 'Require idVerified=true in POD before marking a controlled substance stop as completed',
    resourceIds: csNoPodIdVerify.map(s => s.id), blocksDeployment: true,
  });

  // P1: PHI-touching BAA vendors without signed agreement
  const unsignedBaa = await db
    .select({ id: baaRegistry.id, vendorName: baaRegistry.vendorName })
    .from(baaRegistry)
    .where(and(
      eq(baaRegistry.orgId, orgId),
      eq(baaRegistry.touchesPhi, true),
      ne(baaRegistry.baaStatus, 'signed'),
      ne(baaRegistry.baaStatus, 'not_required'),
    ));
  if (unsignedBaa.length > 0) findings.push({
    orgId, severity: 'P1', category: 'hipaa',
    checkName: 'hipaa_phi_baa_unsigned',
    description: `${unsignedBaa.length} PHI-touching vendor(s) without signed BAA: ${unsignedBaa.map(b => b.vendorName).join(', ')}`,
    count: unsignedBaa.length, legalRef: '45 CFR §164.308(b)',
    recommendation: 'Execute BAA with all PHI-touching business associates before going live with patient data',
    resourceIds: unsignedBaa.map(b => b.id), blocksDeployment: false,
  });

  // P2: BAA agreements expiring within 30 days
  const expiringBaa = await db
    .select({ id: baaRegistry.id, vendorName: baaRegistry.vendorName })
    .from(baaRegistry)
    .where(and(
      eq(baaRegistry.orgId, orgId),
      eq(baaRegistry.baaStatus, 'signed'),
      isNotNull(baaRegistry.expiresAt),
      lt(baaRegistry.expiresAt, in30Days()),
      gt(baaRegistry.expiresAt, new Date()),
    ));
  if (expiringBaa.length > 0) findings.push({
    orgId, severity: 'P2', category: 'hipaa',
    checkName: 'hipaa_baa_expiring_soon',
    description: `${expiringBaa.length} BAA agreement(s) expiring within 30 days`,
    count: expiringBaa.length, legalRef: '45 CFR §164.308(b)',
    recommendation: 'Renew BAA agreements before expiration to maintain continuous HIPAA compliance',
    resourceIds: expiringBaa.map(b => b.id), blocksDeployment: false,
  });

  // P2: No audit log activity in past 7 days
  const [{ cnt: auditCount }] = await db
    .select({ cnt: count() })
    .from(auditLogs)
    .where(and(eq(auditLogs.orgId, orgId), gt(auditLogs.createdAt, ago7Days())));
  if (auditCount === 0) findings.push({
    orgId, severity: 'P2', category: 'hipaa',
    checkName: 'hipaa_no_audit_activity',
    description: 'No HIPAA audit log entries recorded in the past 7 days',
    count: 0, legalRef: '45 CFR §164.312(b)',
    recommendation: 'Verify audit logging middleware is active. All PHI access events must be logged.',
    resourceIds: [], blocksDeployment: false,
  });

  // P1: Non-terminal CS stops with requiresSignature disabled — only flag stops that haven't been delivered yet
  // Terminal statuses (completed/failed/rescheduled) can't be retroactively fixed, so we exclude them
  const csNoSig = await db
    .select({ id: stops.id })
    .from(stops)
    .where(and(
      eq(stops.orgId, orgId),
      eq(stops.controlledSubstance, true),
      eq(stops.requiresSignature, false),
      isNull(stops.deletedAt),
      notInArray(stops.status, ['completed', 'failed', 'rescheduled']),
    ));
  if (csNoSig.length > 0) findings.push({
    orgId, severity: 'P1', category: 'hipaa',
    checkName: 'hipaa_cs_no_signature_required',
    description: `${csNoSig.length} controlled substance stop(s) have signature requirement disabled`,
    count: csNoSig.length, legalRef: '45 CFR §164.312 / R 338.3162',
    recommendation: 'Enable requiresSignature on all controlled substance stops',
    resourceIds: csNoSig.map(s => s.id), blocksDeployment: false,
  });

  return findings;
}

// ─── Michigan Checks ──────────────────────────────────────────────────────────

async function michiganChecks(orgId: string): Promise<ComplianceFinding[]> {
  const findings: ComplianceFinding[] = [];

  // P0: CS deliveries completed without ID photo in POD
  const csNoIdPhoto = await db
    .select({ id: stops.id })
    .from(stops)
    .leftJoin(proofOfDeliveries, eq(proofOfDeliveries.stopId, stops.id))
    .where(and(
      eq(stops.orgId, orgId),
      eq(stops.controlledSubstance, true),
      eq(stops.status, 'completed'),
      isNull(stops.deletedAt),
      or(isNull(proofOfDeliveries.id), isNull(proofOfDeliveries.idPhotoUrl)),
    ));
  if (csNoIdPhoto.length > 0) findings.push({
    orgId, severity: 'P0', category: 'michigan',
    checkName: 'mi_cs_no_id_photo',
    description: `${csNoIdPhoto.length} completed controlled substance delivery(ies) missing ID photo in proof of delivery`,
    count: csNoIdPhoto.length, legalRef: 'R 338.3162 / MCL 333.17735',
    recommendation: 'Michigan law requires photo ID capture for all controlled substance deliveries. Enforce id_photo_url in driver app.',
    resourceIds: csNoIdPhoto.map(s => s.id), blocksDeployment: true,
  });

  // P0: CS deliveries completed without DOB confirmation
  const csNoDob = await db
    .select({ id: stops.id })
    .from(stops)
    .leftJoin(proofOfDeliveries, eq(proofOfDeliveries.stopId, stops.id))
    .where(and(
      eq(stops.orgId, orgId),
      eq(stops.controlledSubstance, true),
      eq(stops.status, 'completed'),
      isNull(stops.deletedAt),
      or(isNull(proofOfDeliveries.id), isNull(proofOfDeliveries.idDobConfirmed), eq(proofOfDeliveries.idDobConfirmed, false)),
    ));
  if (csNoDob.length > 0) findings.push({
    orgId, severity: 'P0', category: 'michigan',
    checkName: 'mi_cs_no_dob_confirmed',
    description: `${csNoDob.length} completed controlled substance delivery(ies) missing DOB confirmation in proof of delivery`,
    count: csNoDob.length, legalRef: 'R 338.3162 / MCL 333.17701',
    recommendation: 'Date of birth verification is required for all controlled substance deliveries in Michigan',
    resourceIds: csNoDob.map(s => s.id), blocksDeployment: true,
  });

  // P1: CS stops completed with no POD record at all
  const csNoPod = await db
    .select({ id: stops.id })
    .from(stops)
    .leftJoin(proofOfDeliveries, eq(proofOfDeliveries.stopId, stops.id))
    .where(and(
      eq(stops.orgId, orgId),
      eq(stops.controlledSubstance, true),
      eq(stops.status, 'completed'),
      isNull(stops.deletedAt),
      isNull(proofOfDeliveries.id),
    ));
  if (csNoPod.length > 0) findings.push({
    orgId, severity: 'P1', category: 'michigan',
    checkName: 'mi_cs_completed_no_pod',
    description: `${csNoPod.length} completed controlled substance stop(s) have no proof of delivery record`,
    count: csNoPod.length, legalRef: 'R 338.3162 / MCL 333.17735',
    recommendation: 'All controlled substance deliveries must have a complete POD record. Investigate missing records.',
    resourceIds: csNoPod.map(s => s.id), blocksDeployment: false,
  });

  // P1: Drug-incapable drivers assigned to routes with CS stops
  // Uses raw SQL for the 4-table join
  const drugIncapable = await db.execute<{ route_id: string; driver_id: string }>(sql`
    SELECT DISTINCT r.id AS route_id, r.driver_id
    FROM routes r
    JOIN plans p ON p.id = r.plan_id
    JOIN stops s ON s.route_id = r.id
    JOIN drivers d ON d.id = r.driver_id
    WHERE p.org_id = ${orgId}
      AND p.deleted_at IS NULL
      AND r.deleted_at IS NULL
      AND s.controlled_substance = true
      AND s.deleted_at IS NULL
      AND d.drug_capable = false
      AND r.driver_id IS NOT NULL
      AND r.status != 'completed'
      AND p.status != 'completed'
  `);
  if (drugIncapable.length > 0) findings.push({
    orgId, severity: 'P1', category: 'michigan',
    checkName: 'mi_drug_incapable_driver_on_cs_route',
    description: `${drugIncapable.length} route(s) with controlled substance stops assigned to non-drug-capable drivers`,
    count: drugIncapable.length, legalRef: 'MCL 333.17701 / R 338.3162',
    recommendation: 'Only drivers with drugCapable=true may be assigned to routes containing controlled substance deliveries',
    resourceIds: (drugIncapable as any[]).map(r => r.route_id as string), blocksDeployment: false,
  });

  // P1: Recurring CS deliveries with requiresSignature disabled
  const recurringCsNoSig = await db
    .select({ id: recurringDeliveries.id })
    .from(recurringDeliveries)
    .where(and(
      eq(recurringDeliveries.orgId, orgId),
      eq(recurringDeliveries.isControlled, true),
      eq(recurringDeliveries.requiresSignature, false),
      isNull(recurringDeliveries.deletedAt),
    ));
  if (recurringCsNoSig.length > 0) findings.push({
    orgId, severity: 'P1', category: 'michigan',
    checkName: 'mi_recurring_cs_no_signature',
    description: `${recurringCsNoSig.length} recurring controlled substance delivery(ies) have signature requirement disabled`,
    count: recurringCsNoSig.length, legalRef: 'R 338.3162',
    recommendation: 'Enable requiresSignature on all recurring controlled substance delivery records',
    resourceIds: recurringCsNoSig.map(r => r.id), blocksDeployment: false,
  });

  // P2: Michigan compliance checklist items with overdue due dates
  const overdueItems = await db
    .select({ id: miComplianceItems.id })
    .from(miComplianceItems)
    .where(and(
      eq(miComplianceItems.orgId, orgId),
      ne(miComplianceItems.status, 'compliant'),
      lt(miComplianceItems.dueDate, new Date()),
    ));
  if (overdueItems.length > 0) findings.push({
    orgId, severity: 'P2', category: 'michigan',
    checkName: 'mi_checklist_items_overdue',
    description: `${overdueItems.length} Michigan compliance checklist item(s) are past their due date`,
    count: overdueItems.length, legalRef: 'MCL 333.17708 / R 338.3162',
    recommendation: 'Review and complete all overdue Michigan compliance checklist items',
    resourceIds: overdueItems.map(i => i.id), blocksDeployment: false,
  });

  return findings;
}

// Scanner-generated check names — used to scope deletes so manual checks aren't wiped
const SCANNER_CHECK_NAMES = [
  'hipaa_cs_no_age_verify', 'hipaa_cs_no_pod_id_verify', 'hipaa_phi_baa_unsigned',
  'hipaa_baa_expiring_soon', 'hipaa_no_audit_activity', 'hipaa_cs_no_signature_required',
  'mi_cs_no_id_photo', 'mi_cs_no_dob_confirmed', 'mi_cs_completed_no_pod',
  'mi_drug_incapable_driver_on_cs_route', 'mi_recurring_cs_no_signature', 'mi_checklist_items_overdue',
];

// ─── Persistence ──────────────────────────────────────────────────────────────

async function persistFindings(findings: ComplianceFinding[], scannedOrgIds: string[]): Promise<void> {
  const toInsert = findings.map(f => ({
    orgId: f.orgId,
    category: f.category,
    checkName: f.checkName,
    status: f.count > 0 ? 'fail' : 'pass',
    detail: JSON.stringify({
      severity: f.severity,
      description: f.description,
      count: f.count,
      legalRef: f.legalRef,
      recommendation: f.recommendation,
      resourceIds: f.resourceIds,
      blocksDeployment: f.blocksDeployment,
    }),
    lastCheckedAt: new Date(),
  }));

  await db.transaction(async (tx) => {
    // Always delete stale scanner rows for every scanned org — even if org has zero violations
    for (const orgId of scannedOrgIds) {
      await tx.delete(complianceChecks).where(and(
        eq(complianceChecks.orgId, orgId),
        inArray(complianceChecks.checkName, SCANNER_CHECK_NAMES),
      ));
    }
    if (toInsert.length > 0) await tx.insert(complianceChecks).values(toInsert);
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function runComplianceScan(opts: { orgId?: string; persistResults?: boolean } = {}): Promise<ComplianceFinding[]> {
  const { orgId, persistResults = true } = opts;

  const orgIds = orgId
    ? [orgId]
    : (await db.select({ id: organizations.id }).from(organizations).where(isNull(organizations.deletedAt))).map(o => o.id);

  const findings: ComplianceFinding[] = [];
  for (const oid of orgIds) {
    const [hipaa, mi] = await Promise.all([hipaaChecks(oid), michiganChecks(oid)]);
    findings.push(...hipaa, ...mi);
  }

  if (persistResults) await persistFindings(findings, orgIds);
  return findings;
}

export function isDeploymentBlocked(findings: ComplianceFinding[]): boolean {
  return findings.some(f => f.blocksDeployment && f.count > 0);
}

export function findingsSummary(findings: ComplianceFinding[]): string {
  const active = findings.filter(f => f.count > 0);
  if (!active.length) return 'No violations found.';
  const byOrg: Record<string, Record<Severity, number>> = {};
  for (const f of active) {
    byOrg[f.orgId] ??= { P0: 0, P1: 0, P2: 0, P3: 0 };
    byOrg[f.orgId][f.severity]++;
  }
  return Object.entries(byOrg)
    .map(([oid, sev]) => `Org ${oid.slice(0, 8)}…: P0=${sev.P0} P1=${sev.P1} P2=${sev.P2} P3=${sev.P3}`)
    .join('\n');
}
