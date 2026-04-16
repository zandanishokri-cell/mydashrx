import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { proofOfDeliveries, stops, routes } from '../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';
import { uploadBuffer } from '../services/storage.js';

const CS_PATTERNS = /controlled|schedule|c[2-5]\b|cs\b/i;

export const podRoutes: FastifyPluginAsync = async (app) => {
  // GET /stops/:stopId/pod/cs-required
  app.get('/cs-required', { preHandler: requireRole('driver') }, async (req, reply) => {
    const user = req.user as { sub: string; driverId?: string };
    const driverId = user.driverId ?? user.sub;
    const { stopId } = req.params as { stopId: string };
    const [stop] = await db.select().from(stops).where(eq(stops.id, stopId)).limit(1);
    if (!stop) return reply.code(404).send({ error: 'Stop not found' });
    const [route] = await db.select({ driverId: routes.driverId })
      .from(routes).where(and(eq(routes.id, stop.routeId!), isNull(routes.deletedAt))).limit(1);
    if (!route || route.driverId !== driverId) return reply.code(403).send({ error: 'Forbidden' });

    const schedules: string[] = [];
    // Check dedicated column first
    if (stop.controlledSubstance) schedules.push('CS');
    // Also scan notes/metadata for schedule specifics
    const searchText = `${stop.deliveryNotes ?? ''} ${JSON.stringify(stop.rxNumbers ?? [])}`;
    const matches = searchText.match(/c[2-5]/gi) ?? [];
    for (const m of matches) {
      const upper = m.toUpperCase();
      if (!schedules.includes(upper)) schedules.push(upper);
    }
    if (CS_PATTERNS.test(searchText) && schedules.length === 0) schedules.push('CS');

    return { required: stop.controlledSubstance || schedules.length > 0, schedules };
  });

  // POST /stops/:stopId/pod — capture full POD
  app.post('/', { preHandler: requireRole('driver') }, async (req, reply) => {
    const { stopId } = req.params as { stopId: string };
    const user = req.user as { sub: string; driverId?: string };
    const driverId = user.driverId ?? user.sub;

    // Verify driver owns this stop's route
    const [stopCheck] = await db.select({ id: stops.id, routeId: stops.routeId })
      .from(stops).where(eq(stops.id, stopId)).limit(1);
    if (!stopCheck) return reply.code(404).send({ error: 'Stop not found' });
    const [routeCheck] = await db.select({ driverId: routes.driverId })
      .from(routes).where(and(eq(routes.id, stopCheck.routeId!), isNull(routes.deletedAt))).limit(1);
    if (!routeCheck || routeCheck.driverId !== driverId) return reply.code(403).send({ error: 'Forbidden' });

    const body = req.body as {
      packageCount: number;
      recipientName?: string;
      deliveryNotes?: string;
      signatureData?: string;
      idPhotoUrl?: string;
      idVerified?: boolean;
      isControlledSubstance?: boolean;
      idDobConfirmed?: boolean;
      // Legacy fields preserved
      signature?: { svgData: string; signerName: string; lat: number; lng: number };
      ageVerification?: { verified: boolean; idType?: string; idLastFour?: string; dobConfirmed: boolean };
      codCollected?: { amount: number; method: string; note?: string };
      driverNote?: string;
      customerNote?: string;
    };

    const [existing] = await db
      .select()
      .from(proofOfDeliveries)
      .where(eq(proofOfDeliveries.stopId, stopId))
      .limit(1);
    if (existing) return reply.code(409).send({ error: 'POD already captured for this stop' });

    const [pod] = await db.insert(proofOfDeliveries).values({
      stopId,
      driverId,
      packageCount: body.packageCount,
      recipientName: body.recipientName,
      deliveryNotes: body.deliveryNotes,
      signatureData: body.signatureData,
      idPhotoUrl: body.idPhotoUrl,
      idVerified: body.idVerified ?? false,
      isControlledSubstance: body.isControlledSubstance ?? false,
      idDobConfirmed: body.idDobConfirmed ?? false,
      signature: body.signature ? { ...body.signature, capturedAt: new Date().toISOString() } : null,
      photos: [],
      ageVerification: body.ageVerification ?? null,
      codCollected: body.codCollected ?? null,
      driverNote: body.driverNote,
      customerNote: body.customerNote,
    }).returning();

    // Mark stop completed
    await db.update(stops).set({ status: 'completed', completedAt: new Date() }).where(eq(stops.id, stopId));

    // Compliance logging — fire-and-forget
    if (body.isControlledSubstance) {
      const [stopRow] = await db.select().from(stops).where(eq(stops.id, stopId)).limit(1);
      if (!body.idVerified) {
        logCsComplianceWarning(stopRow?.orgId ?? 'unknown', stopId).catch(console.error);
      }
    }

    return reply.code(201).send(pod);
  });

  // POST /stops/:stopId/pod/photo — upload photo to existing POD
  app.post('/photo', { preHandler: requireRole('driver') }, async (req, reply) => {
    const user = req.user as { sub: string; driverId?: string };
    const driverId = user.driverId ?? user.sub;
    const { stopId } = req.params as { stopId: string };
    const [stopCheck] = await db.select({ id: stops.id, routeId: stops.routeId })
      .from(stops).where(eq(stops.id, stopId)).limit(1);
    if (!stopCheck) return reply.code(404).send({ error: 'Not found' });
    const [routeCheck] = await db.select({ driverId: routes.driverId })
      .from(routes).where(and(eq(routes.id, stopCheck.routeId!), isNull(routes.deletedAt))).limit(1);
    if (!routeCheck || routeCheck.driverId !== driverId) return reply.code(403).send({ error: 'Forbidden' });
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'No file uploaded' });

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(data.mimetype))
      return reply.code(400).send({ error: 'Only JPEG, PNG, WEBP allowed' });

    const buffer = await data.toBuffer();
    const { key, url } = await uploadBuffer(buffer, data.mimetype, `pod/${stopId}`);

    const [existing] = await db.select().from(proofOfDeliveries).where(eq(proofOfDeliveries.stopId, stopId)).limit(1);
    if (existing) {
      const photos = (existing.photos as Array<{ key: string; url: string; capturedAt: string }>) ?? [];
      photos.push({ key, url, capturedAt: new Date().toISOString() });
      await db.update(proofOfDeliveries).set({ photos }).where(eq(proofOfDeliveries.stopId, stopId));
    }

    return { key, url };
  });

  // GET /stops/:stopId/pod — dispatcher/pharmacy view
  app.get('/', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const user = req.user as { orgId: string };
    const { stopId } = req.params as { stopId: string };
    // Verify stop belongs to this user's org before serving PHI
    const [stop] = await db.select({ orgId: stops.orgId })
      .from(stops).where(eq(stops.id, stopId)).limit(1);
    if (!stop || stop.orgId !== user.orgId) return reply.code(404).send({ error: 'No POD found for this stop' });
    const [pod] = await db.select().from(proofOfDeliveries).where(eq(proofOfDeliveries.stopId, stopId)).limit(1);
    if (!pod) return reply.code(404).send({ error: 'No POD found for this stop' });
    return pod;
  });
};

async function logCsComplianceWarning(orgId: string, stopId: string) {
  // We need a ruleId reference — use a sentinel approach: log to automation_log
  // by finding or skipping if no rule exists. This is best-effort compliance audit.
  try {
    // automationLog requires ruleId FK — log to auditLogs instead via raw insert workaround
    // Since automationLog requires a valid ruleId FK, we'll use a direct audit approach
    // This is a fire-and-forget compliance note — if no automation rule exists, skip gracefully
    const { auditLogs } = await import('../db/schema.js');
    await db.insert(auditLogs).values({
      orgId,
      action: 'cs_delivery_no_id',
      resource: 'stop',
      resourceId: stopId,
      metadata: {
        detail: 'Controlled substance delivered without ID verification',
        rule: 'R 338.3162',
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    // non-blocking
  }
}
