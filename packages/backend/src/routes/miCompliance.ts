import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { miComplianceItems, regulatoryUpdates } from '../db/schema.js';
import { eq, and, count, sql } from 'drizzle-orm';
import { requireOrgRole } from '../middleware/requireOrgRole.js';

const ADMIN_ROLES = ['pharmacy_admin', 'super_admin'] as const;
const READ_ROLES = ['pharmacy_admin', 'super_admin', 'pharmacist'] as const;

const VALID_CATEGORIES = ['maps_reporting', 'id_verification', 'record_retention', 'pharmacy_licensure', 'data_destruction', 'breach_readiness'];
const VALID_SOURCES = ['LARA', 'Board of Pharmacy', 'MDHHS', 'AG', 'Legislature'];

const defaultItems = [
  { category: 'maps_reporting', itemName: 'Daily MAPS reporting configured for controlled substances', legalRef: 'MCL 333.17735' },
  { category: 'maps_reporting', itemName: 'Patient identifiers submitted to MAPS before controlled substance dispensing', legalRef: 'MCL 333.17735' },
  { category: 'id_verification', itemName: 'Photo ID + DOB captured for all controlled substance deliveries', legalRef: 'R 338.3162' },
  { category: 'id_verification', itemName: 'ID verification photos stored securely with delivery records', legalRef: 'R 338.3162' },
  { category: 'id_verification', itemName: 'Pharmacist or intern supervision documented for controlled substance dispensing', legalRef: 'MCL 333.17701' },
  { category: 'record_retention', itemName: 'Controlled substance records retained minimum 2 years', legalRef: 'R 338.3162' },
  { category: 'record_retention', itemName: 'HIPAA audit logs retained minimum 6 years', legalRef: '45 CFR 164.530' },
  { category: 'pharmacy_licensure', itemName: 'All serviced pharmacies verified to hold valid Michigan pharmacy license', legalRef: 'MCL 333.17708' },
  { category: 'data_destruction', itemName: 'Data destruction policy in place for expired personal information', legalRef: 'MCL 445.79c' },
  { category: 'breach_readiness', itemName: 'Incident response plan documented', legalRef: 'MCL 445.72' },
  { category: 'breach_readiness', itemName: 'Michigan AG notification procedure documented (for breaches affecting 100+ residents)', legalRef: 'MCL 445.72' },
  { category: 'breach_readiness', itemName: 'Notification templates ready for affected residents', legalRef: 'MCL 445.72' },
];

const defaultUpdates = [
  {
    title: 'Electronic Prescribing Mandate — All Prescriptions',
    summary: 'As of January 1, 2023, MCL 333.17754a requires all prescriptions to be transmitted electronically, with limited exceptions. MyDashRx integrations with pharmacy systems must support e-prescribing format validation.',
    source: 'Legislature',
    impactLevel: 'high',
    effectiveDate: new Date('2023-01-01'),
  },
  {
    title: 'Michigan Personal Data Privacy Act (SB 359) — Monitoring',
    summary: "Passed Michigan Senate in 2025. Would create Michigan's first comprehensive consumer privacy framework with new obligations for data controllers, including healthcare platforms. Track for final passage and signing.",
    source: 'Legislature',
    impactLevel: 'medium',
    effectiveDate: null,
  },
  {
    title: 'Identity Theft Protection Act Amendments (SB 360-364)',
    summary: 'Would tighten breach notification rules, require security coordinators, and mandate AG notification for breaches affecting 100+ residents. Passed Michigan Senate 2025 — monitor for governor signature.',
    source: 'Legislature',
    impactLevel: 'high',
    effectiveDate: null,
  },
];

const CATEGORIES = ['maps_reporting', 'id_verification', 'record_retention', 'pharmacy_licensure', 'data_destruction', 'breach_readiness'] as const;

function categoryStatus(items: { status: string }[]): string {
  if (!items.length) return 'pending';
  if (items.some(i => i.status === 'non_compliant')) return 'non_compliant';
  if (items.some(i => i.status === 'warning')) return 'warning';
  if (items.every(i => i.status === 'compliant')) return 'compliant';
  return 'pending';
}

export const miComplianceRoutes: FastifyPluginAsync = async (app) => {
  // Dashboard
  app.get('/dashboard', { preHandler: requireOrgRole(...READ_ROLES) }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const items = await db.select().from(miComplianceItems).where(eq(miComplianceItems.orgId, orgId));
    const updates = await db.select().from(regulatoryUpdates).where(eq(regulatoryUpdates.orgId, orgId));

    const categories: Record<string, { status: string; itemCount: number; nonCompliantCount: number }> = {};
    for (const cat of CATEGORIES) {
      const catItems = items.filter(i => i.category === cat);
      categories[cat] = {
        status: categoryStatus(catItems),
        itemCount: catItems.length,
        nonCompliantCount: catItems.filter(i => i.status === 'non_compliant').length,
      };
    }

    const compliantCount = items.filter(i => i.status === 'compliant').length;
    const score = items.length > 0 ? Math.round((compliantCount / items.length) * 100) : 0;

    const nonCompliantAny = items.some(i => i.status === 'non_compliant');
    const warningAny = items.some(i => i.status === 'warning');
    const overallStatus = nonCompliantAny ? 'non_compliant' : warningAny ? 'warning' : score === 100 ? 'compliant' : 'pending';

    return {
      overallStatus,
      score,
      categories,
      unacknowledgedUpdates: updates.filter(u => !u.acknowledged).length,
      pendingItems: items.filter(i => i.status === 'pending').length,
    };
  });

  // List items
  app.get('/items', { preHandler: requireOrgRole(...READ_ROLES) }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const { category } = req.query as { category?: string };
    const where = category
      ? and(eq(miComplianceItems.orgId, orgId), eq(miComplianceItems.category, category))
      : eq(miComplianceItems.orgId, orgId);
    return db.select().from(miComplianceItems).where(where).orderBy(miComplianceItems.category, miComplianceItems.createdAt);
  });

  // Create item
  app.post('/items', { preHandler: requireOrgRole(...ADMIN_ROLES) }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = req.body as { category: string; itemName: string; legalRef?: string; notes?: string; dueDate?: string };
    if (!body.itemName?.trim()) return reply.code(400).send({ error: 'itemName is required' });
    if (!body.category || !VALID_CATEGORIES.includes(body.category)) {
      return reply.code(400).send({ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` });
    }
    const [item] = await db.insert(miComplianceItems).values({
      orgId,
      category: body.category,
      itemName: body.itemName,
      legalRef: body.legalRef,
      notes: body.notes,
      dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
    }).returning();
    reply.code(201).send(item);
  });

  // Update item
  const VALID_MI_ITEM_STATUSES = ['compliant', 'warning', 'non_compliant', 'pending'];
  app.patch('/items/:id', { preHandler: requireOrgRole(...ADMIN_ROLES) }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const body = req.body as { status?: string; notes?: string; dueDate?: string };
    if (body.status !== undefined && !VALID_MI_ITEM_STATUSES.includes(body.status)) {
      return reply.code(400).send({ error: `Invalid status. Must be one of: ${VALID_MI_ITEM_STATUSES.join(', ')}` });
    }
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.status !== undefined) updates.status = body.status;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.dueDate !== undefined) updates.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    if (body.status === 'compliant') updates.completedAt = new Date();
    const [item] = await db.update(miComplianceItems)
      .set(updates)
      .where(and(eq(miComplianceItems.id, id), eq(miComplianceItems.orgId, orgId)))
      .returning();
    if (!item) return reply.code(404).send({ error: 'Not found' });
    return item;
  });

  // Init — seed default checklist
  app.post('/init', { preHandler: requireOrgRole(...ADMIN_ROLES) }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const existing = await db.select({ cnt: sql<number>`count(*)::int` })
      .from(miComplianceItems).where(eq(miComplianceItems.orgId, orgId));
    if ((existing[0]?.cnt ?? 0) > 0) {
      const existingUpdates = await db.select({ cnt: sql<number>`count(*)::int` })
        .from(regulatoryUpdates).where(eq(regulatoryUpdates.orgId, orgId));
      return { seeded: false, message: 'Compliance checklist already initialized', itemCount: existing[0].cnt, updateCount: existingUpdates[0]?.cnt ?? 0 };
    }
    const items = await db.insert(miComplianceItems)
      .values(defaultItems.map(i => ({ ...i, orgId })))
      .returning();
    const updates = await db.insert(regulatoryUpdates)
      .values(defaultUpdates.map(u => ({ ...u, orgId, effectiveDate: u.effectiveDate ?? undefined })))
      .returning();
    reply.code(201).send({ seeded: true, itemCount: items.length, updateCount: updates.length });
  });

  // List regulatory updates
  app.get('/regulatory', { preHandler: requireOrgRole(...READ_ROLES) }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const { unacknowledged } = req.query as { unacknowledged?: string };
    const where = unacknowledged === 'true'
      ? and(eq(regulatoryUpdates.orgId, orgId), eq(regulatoryUpdates.acknowledged, false))
      : eq(regulatoryUpdates.orgId, orgId);
    return db.select().from(regulatoryUpdates).where(where).orderBy(regulatoryUpdates.createdAt);
  });

  // Add regulatory update
  const VALID_IMPACT_LEVELS = ['critical', 'high', 'medium', 'low'];
  app.post('/regulatory', { preHandler: requireOrgRole(...ADMIN_ROLES) }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = req.body as { title: string; summary: string; source: string; impactLevel?: string; effectiveDate?: string; url?: string };
    if (!body.title?.trim() || !body.summary?.trim()) return reply.code(400).send({ error: 'title and summary are required' });
    if (body.source !== undefined && !VALID_SOURCES.includes(body.source)) {
      return reply.code(400).send({ error: `Invalid source. Must be one of: ${VALID_SOURCES.join(', ')}` });
    }
    if (body.impactLevel !== undefined && !VALID_IMPACT_LEVELS.includes(body.impactLevel)) {
      return reply.code(400).send({ error: `Invalid impactLevel. Must be one of: ${VALID_IMPACT_LEVELS.join(', ')}` });
    }
    const [update] = await db.insert(regulatoryUpdates).values({
      orgId,
      title: body.title,
      summary: body.summary,
      source: body.source,
      impactLevel: body.impactLevel ?? 'medium',
      effectiveDate: body.effectiveDate ? new Date(body.effectiveDate) : undefined,
      url: body.url,
    }).returning();
    reply.code(201).send(update);
  });

  // Acknowledge regulatory update
  app.patch('/regulatory/:id', { preHandler: requireOrgRole(...ADMIN_ROLES) }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const [update] = await db.update(regulatoryUpdates)
      .set({ acknowledged: true, acknowledgedAt: new Date() })
      .where(and(eq(regulatoryUpdates.id, id), eq(regulatoryUpdates.orgId, orgId)))
      .returning();
    if (!update) return reply.code(404).send({ error: 'Not found' });
    return update;
  });
};
