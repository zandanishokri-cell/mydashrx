import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { recurringDeliveries, stops, routes, plans, depots } from '../db/schema.js';
import { eq, and, isNull, lte, inArray } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';
import { geocodeAddress } from '../utils/geocode.js';

// All date arithmetic is done in UTC ms to avoid local-timezone drift.
// Weekly/biweekly use pure millisecond offsets; monthly uses setUTCMonth with day clamping.
function calcNextDate(from: Date, schedule: string, customIntervalDays?: number | null): Date {
  const ms = from.getTime();
  if (schedule === 'weekly') return new Date(ms + 7 * 86_400_000);
  if (schedule === 'biweekly') return new Date(ms + 14 * 86_400_000);
  if (schedule === 'monthly') {
    const d = new Date(from);
    const targetMonth = d.getUTCMonth() + 1;
    d.setUTCMonth(targetMonth);
    if (d.getUTCMonth() !== targetMonth % 12) d.setUTCDate(0);
    return d;
  }
  if (schedule === 'custom') {
    const days = customIntervalDays && customIntervalDays > 0 ? customIntervalDays : 7;
    return new Date(ms + days * 86_400_000);
  }
  return new Date(ms + 7 * 86_400_000);
}

// Combine a date with a time-of-day string ("HH:MM" or "HH:MM:SS") into a UTC timestamp.
function combineDateTime(date: Date, timeStr: string | null | undefined): Date | undefined {
  if (!timeStr) return undefined;
  const parts = timeStr.split(':').map(Number);
  const d = new Date(date);
  d.setUTCHours(parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, 0);
  return d;
}

export const recurringRoutes: FastifyPluginAsync = async (app) => {
  // List
  app.get('/', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    return db.select().from(recurringDeliveries)
      .where(and(eq(recurringDeliveries.orgId, orgId), isNull(recurringDeliveries.deletedAt)))
      .orderBy(recurringDeliveries.createdAt);
  });

  // Create
  app.post('/', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = req.body as {
      recipientName: string;
      address: string;
      lat?: number;
      lng?: number;
      recipientPhone?: string;
      recipientEmail?: string;
      notes?: string;
      schedule?: 'weekly' | 'biweekly' | 'monthly' | 'custom';
      dayOfWeek?: number;
      dayOfMonth?: number;
      nextDeliveryDate?: string;
      endDate?: string;
      rxNumber?: string;
      isControlled?: boolean;
      requiresSignature?: boolean;
      requiresRefrigeration?: boolean;
      windowStartTime?: string;
      windowEndTime?: string;
      customIntervalDays?: number;
      depotId?: string;
    };

    if (!body.recipientName) return reply.code(400).send({ error: 'recipientName required' });
    if (!body.address) return reply.code(400).send({ error: 'address required' });

    // Geocode if lat/lng not provided by caller
    let { lat, lng } = { lat: body.lat, lng: body.lng };
    if (lat == null || lng == null) {
      const geo = await geocodeAddress(body.address);
      lat = geo.lat;
      lng = geo.lng;
    }

    const [rec] = await db.insert(recurringDeliveries).values({
      orgId,
      recipientName: body.recipientName,
      address: body.address,
      lat,
      lng,
      recipientPhone: body.recipientPhone,
      recipientEmail: body.recipientEmail,
      notes: body.notes,
      schedule: body.schedule ?? 'weekly',
      dayOfWeek: body.dayOfWeek,
      dayOfMonth: body.dayOfMonth,
      nextDeliveryDate: body.nextDeliveryDate ? new Date(body.nextDeliveryDate) : new Date(),
      endDate: body.endDate ? new Date(body.endDate) : undefined,
      rxNumber: body.rxNumber,
      isControlled: body.isControlled ?? false,
      requiresSignature: body.requiresSignature ?? true,
      requiresRefrigeration: body.requiresRefrigeration ?? false,
      windowStartTime: body.windowStartTime,
      windowEndTime: body.windowEndTime,
      customIntervalDays: body.customIntervalDays,
      depotId: body.depotId,
    }).returning();

    return reply.code(201).send(rec);
  });

  // Update — scoped to orgId to prevent cross-org mutation
  app.patch('/:id', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const body = req.body as Record<string, unknown>;

    const allowed = ['recipientName', 'address', 'lat', 'lng', 'recipientPhone', 'recipientEmail',
      'notes', 'schedule', 'dayOfWeek', 'dayOfMonth', 'nextDeliveryDate', 'endDate',
      'rxNumber', 'isControlled', 'enabled', 'requiresSignature', 'requiresRefrigeration',
      'windowStartTime', 'windowEndTime', 'customIntervalDays', 'depotId'];
    const updates: Record<string, unknown> = {};
    for (const k of allowed) {
      if (k in body) {
        if ((k === 'nextDeliveryDate' || k === 'endDate') && body[k]) {
          updates[k] = new Date(body[k] as string);
        } else {
          updates[k] = body[k];
        }
      }
    }

    if (Object.keys(updates).length === 0) return reply.code(400).send({ error: 'No valid fields' });
    const [updated] = await db.update(recurringDeliveries).set(updates)
      .where(and(eq(recurringDeliveries.id, id), eq(recurringDeliveries.orgId, orgId), isNull(recurringDeliveries.deletedAt)))
      .returning();
    if (!updated) return reply.code(404).send({ error: 'Not found' });
    return updated;
  });

  // Soft delete — scoped to orgId to prevent cross-org deletion
  app.delete('/:id', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const [deleted] = await db.update(recurringDeliveries)
      .set({ deletedAt: new Date() })
      .where(and(eq(recurringDeliveries.id, id), eq(recurringDeliveries.orgId, orgId), isNull(recurringDeliveries.deletedAt)))
      .returning({ id: recurringDeliveries.id });
    if (!deleted) return reply.code(404).send({ error: 'Not found' });
    return reply.code(204).send();
  });

  // Generate stops for due recurring deliveries
  app.post('/generate', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const { date, planId } = req.body as { date: string; planId?: string };
    if (!date) return reply.code(400).send({ error: 'date required' });

    const targetDate = new Date(date);

    // Find all enabled, non-deleted recurring deliveries due by targetDate
    const allDue = await db.select().from(recurringDeliveries)
      .where(and(
        eq(recurringDeliveries.orgId, orgId),
        eq(recurringDeliveries.enabled, true),
        isNull(recurringDeliveries.deletedAt),
        lte(recurringDeliveries.nextDeliveryDate, targetDate),
      ));

    // Filter out schedules that have passed their endDate
    const due = allDue.filter(rec => !rec.endDate || rec.endDate >= targetDate);

    if (due.length === 0) return { generated: 0, stops: [] };

    // Resolve route to attach stops to — all queries scoped to this org's plans
    let routeId: string | undefined;
    if (planId) {
      const [existingRoute] = await db.select({ id: routes.id }).from(routes)
        .where(and(eq(routes.planId, planId), isNull(routes.deletedAt)))
        .limit(1);
      routeId = existingRoute?.id;
    }

    if (!routeId) {
      const orgPlans = await db.select({ id: plans.id }).from(plans)
        .where(and(eq(plans.orgId, orgId), isNull(plans.deletedAt)));
      if (orgPlans.length > 0) {
        const planIds = orgPlans.map(p => p.id);
        const [existingRoute] = await db.select({ id: routes.id }).from(routes)
          .where(and(inArray(routes.planId, planIds), isNull(routes.deletedAt), eq(routes.status, 'pending')))
          .limit(1);
        routeId = existingRoute?.id;
      }
    }

    if (!routeId) {
      const [depot] = await db.select({ id: depots.id }).from(depots)
        .where(eq(depots.orgId, orgId))
        .limit(1);
      if (!depot) return reply.code(400).send({ error: 'No depot configured' });
      const [plan] = await db.insert(plans).values({ orgId, depotId: depot.id, date }).returning();
      const [newRoute] = await db.insert(routes).values({ planId: plan.id }).returning();
      routeId = newRoute.id;
    }

    type StopInsert = typeof stops.$inferInsert;
    const stopValues: StopInsert[] = due.map(rec => ({
      routeId: routeId!,
      orgId,
      recipientName: rec.recipientName,
      recipientPhone: rec.recipientPhone ?? '',
      recipientEmail: rec.recipientEmail ?? undefined,
      address: rec.address,
      lat: rec.lat ?? 0,
      lng: rec.lng ?? 0,
      deliveryNotes: rec.notes || undefined,
      rxNumbers: rec.rxNumber ? [rec.rxNumber] : [],
      controlledSubstance: rec.isControlled,
      requiresSignature: rec.requiresSignature,
      requiresRefrigeration: rec.requiresRefrigeration,
      windowStart: combineDateTime(targetDate, rec.windowStartTime),
      windowEnd: combineDateTime(targetDate, rec.windowEndTime),
      status: 'pending' as const,
    }));

    const inserted = await db.insert(stops).values(stopValues).returning({ id: stops.id });

    // Update lastDeliveryDate and nextDeliveryDate for each
    await Promise.all(due.map(rec =>
      db.update(recurringDeliveries).set({
        lastDeliveryDate: targetDate,
        nextDeliveryDate: calcNextDate(targetDate, rec.schedule, rec.customIntervalDays),
      }).where(eq(recurringDeliveries.id, rec.id))
    ));

    return { generated: inserted.length, stops: inserted.map(s => s.id) };
  });
};
