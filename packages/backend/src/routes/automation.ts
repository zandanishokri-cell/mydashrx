import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { automationRules, automationLog } from '../db/schema.js';
import { eq, and, desc, lte } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';
import { executeRule } from '../services/automation.js';

const authRoles = ['dispatcher', 'pharmacy_admin', 'super_admin'] as const;

const seedDefaults = [
  {
    name: 'Notify patient: delivery completed',
    trigger: 'stop_completed' as const,
    smsTemplate: 'Hi {{patientName}}, your prescription has been delivered to {{address}}. Thank you for choosing us!',
    emailSubject: 'Your delivery is complete',
    emailTemplate: '<p>Hi {{patientName}},</p><p>Your prescription was successfully delivered to {{address}}.</p>',
    actions: [{ type: 'sms', to: 'patient' }, { type: 'email', to: 'patient' }],
  },
  {
    name: 'Notify patient: delivery failed',
    trigger: 'stop_failed' as const,
    smsTemplate: 'Hi {{patientName}}, we were unable to deliver your prescription to {{address}}. Please call us to reschedule.',
    emailSubject: 'Delivery attempt unsuccessful',
    emailTemplate: '<p>Hi {{patientName}},</p><p>We were unable to complete your delivery to {{address}}. Please contact us to reschedule.</p>',
    actions: [{ type: 'sms', to: 'patient' }, { type: 'email', to: 'patient' }],
  },
  {
    name: 'Alert dispatcher: stop failed',
    trigger: 'stop_failed' as const,
    emailSubject: 'Delivery failed: {{address}}',
    emailTemplate: '<p>A delivery has failed.</p><p>Address: {{address}}</p><p>Patient: {{patientName}}</p>',
    actions: [{ type: 'email', to: 'dispatcher' }],
  },
];

const VALID_TRIGGERS = [
  'stop_completed', 'stop_failed', 'stop_status_changed',
  'driver_started_route', 'route_completed', 'stop_approaching',
] as const;

const SAMPLE_DATA: Record<string, Record<string, string>> = {
  stop_completed:       { patientName: 'Jane Smith', patientPhone: '+15005550006', patientEmail: 'patient@example.com', address: '123 Main St, Detroit, MI', stopStatus: 'completed', driverName: 'Marcus J.' },
  stop_failed:          { patientName: 'Jane Smith', patientPhone: '+15005550006', patientEmail: 'patient@example.com', address: '456 Oak Ave, Ann Arbor, MI', stopStatus: 'failed', driverName: 'Marcus J.' },
  stop_status_changed:  { patientName: 'Jane Smith', patientPhone: '+15005550006', patientEmail: 'patient@example.com', address: '789 Elm St, Dearborn, MI', stopStatus: 'arrived', driverName: 'Marcus J.' },
  driver_started_route: { patientName: 'Jane Smith', patientPhone: '+15005550006', patientEmail: 'patient@example.com', address: '321 Pine Rd, Lansing, MI', stopStatus: 'pending', driverName: 'Marcus J.', routeId: 'test-route', driverId: 'test-driver' },
  route_completed:      { patientName: '', patientPhone: '', patientEmail: '', address: '', driverName: 'Marcus J.', routeId: 'test-route', completedCount: '8', totalStops: '10', failedCount: '2' },
  stop_approaching:     { patientName: 'Jane Smith', patientPhone: '+15005550006', patientEmail: 'patient@example.com', address: '654 Birch Ln, Flint, MI', stopStatus: 'pending', driverName: 'Marcus J.', stopsAway: '2', etaMin: '16' },
};

export const automationRoutes: FastifyPluginAsync = async (app) => {
  // GET /orgs/:orgId/automation/rules
  app.get('/rules', { preHandler: requireRole(...authRoles) }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    return db.select().from(automationRules)
      .where(eq(automationRules.orgId, orgId))
      .orderBy(desc(automationRules.createdAt));
  });

  // POST /orgs/:orgId/automation/rules
  app.post('/rules', { preHandler: requireRole(...authRoles) }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = req.body as {
      name: string;
      trigger: typeof automationRules.$inferInsert['trigger'];
      enabled?: boolean;
      conditions?: Record<string, unknown>;
      actions: Array<{ type: string; to: string }>;
      smsTemplate?: string;
      emailSubject?: string;
      emailTemplate?: string;
    };
    if (!body.name?.trim()) return reply.code(400).send({ error: 'name is required' });
    if (!VALID_TRIGGERS.includes(body.trigger as any)) {
      return reply.code(400).send({ error: `Invalid trigger. Must be one of: ${VALID_TRIGGERS.join(', ')}` });
    }
    if (!Array.isArray(body.actions) || body.actions.length === 0) {
      return reply.code(400).send({ error: 'At least one action is required' });
    }
    const [rule] = await db.insert(automationRules).values({
      orgId,
      name: body.name,
      trigger: body.trigger,
      enabled: body.enabled ?? true,
      conditions: body.conditions ?? {},
      actions: body.actions,
      smsTemplate: body.smsTemplate,
      emailSubject: body.emailSubject,
      emailTemplate: body.emailTemplate,
    }).returning();
    return reply.code(201).send(rule);
  });

  // GET /orgs/:orgId/automation/rules/:ruleId
  app.get('/rules/:ruleId', { preHandler: requireRole(...authRoles) }, async (req, reply) => {
    const { orgId, ruleId } = req.params as { orgId: string; ruleId: string };
    const [rule] = await db.select().from(automationRules)
      .where(and(eq(automationRules.id, ruleId), eq(automationRules.orgId, orgId)))
      .limit(1);
    if (!rule) return reply.code(404).send({ error: 'Not found' });
    return rule;
  });

  // PATCH /orgs/:orgId/automation/rules/:ruleId
  app.patch('/rules/:ruleId', { preHandler: requireRole(...authRoles) }, async (req, reply) => {
    const { orgId, ruleId } = req.params as { orgId: string; ruleId: string };
    const body = req.body as Partial<{
      name: string;
      trigger: typeof automationRules.$inferInsert['trigger'];
      enabled: boolean;
      conditions: Record<string, unknown>;
      actions: Array<{ type: string; to: string }>;
      smsTemplate: string;
      emailSubject: string;
      emailTemplate: string;
    }>;
    if (body.trigger !== undefined && !VALID_TRIGGERS.includes(body.trigger as any)) {
      return reply.code(400).send({ error: `Invalid trigger. Must be one of: ${VALID_TRIGGERS.join(', ')}` });
    }
    const allowed = ['name', 'trigger', 'enabled', 'conditions', 'actions', 'smsTemplate', 'emailSubject', 'emailTemplate'];
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of allowed) if (k in body) updates[k] = (body as any)[k];
    const [updated] = await db.update(automationRules).set(updates)
      .where(and(eq(automationRules.id, ruleId), eq(automationRules.orgId, orgId)))
      .returning();
    if (!updated) return reply.code(404).send({ error: 'Not found' });
    return updated;
  });

  // DELETE /orgs/:orgId/automation/rules/:ruleId
  app.delete('/rules/:ruleId', { preHandler: requireRole(...authRoles) }, async (req, reply) => {
    const { orgId, ruleId } = req.params as { orgId: string; ruleId: string };
    const [deleted] = await db.delete(automationRules)
      .where(and(eq(automationRules.id, ruleId), eq(automationRules.orgId, orgId)))
      .returning();
    if (!deleted) return reply.code(404).send({ error: 'Not found' });
    return reply.code(204).send();
  });

  // POST /orgs/:orgId/automation/rules/:ruleId/test — fire with sample data, no side effects
  app.post('/rules/:ruleId/test', { preHandler: requireRole(...authRoles) }, async (req, reply) => {
    const { orgId, ruleId } = req.params as { orgId: string; ruleId: string };
    const [rule] = await db.select().from(automationRules)
      .where(and(eq(automationRules.id, ruleId), eq(automationRules.orgId, orgId)))
      .limit(1);
    if (!rule) return reply.code(404).send({ error: 'Rule not found' });
    const sampleData = SAMPLE_DATA[rule.trigger] ?? {};
    try {
      await executeRule(rule, { orgId, trigger: rule.trigger, resourceId: 'test-fire', data: sampleData });
      return { ok: true, message: 'Test fired. Check SMS/email for delivery confirmation.' };
    } catch (err) {
      return reply.code(422).send({ ok: false, message: `Test failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  // GET /orgs/:orgId/automation/log
  app.get('/log', { preHandler: requireRole(...authRoles) }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const { ruleId } = req.query as { ruleId?: string };
    const conditions = [eq(automationLog.orgId, orgId)];
    if (ruleId) conditions.push(eq(automationLog.ruleId, ruleId));
    return db.select().from(automationLog)
      .where(and(...conditions))
      .orderBy(desc(automationLog.createdAt))
      .limit(100);
  });

  // POST /orgs/:orgId/automation/seed-defaults
  app.post('/seed-defaults', { preHandler: requireRole(...authRoles) }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const existing = await db.select({ id: automationRules.id }).from(automationRules)
      .where(eq(automationRules.orgId, orgId)).limit(1);
    if (existing.length > 0) return reply.code(409).send({ error: 'Rules already exist for this org' });
    const inserted = await db.insert(automationRules).values(
      seedDefaults.map(d => ({ ...d, orgId }))
    ).returning();
    return reply.code(201).send(inserted);
  });
};
