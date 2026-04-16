import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { stops, routes, plans, depots } from '../db/schema.js';
import { eq, isNull, and, inArray } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';
import { todayInTz } from '../utils/date.js';
import { geocodeAddress } from '../utils/geocode.js';

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
  return lines.slice(1).map(line => {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; continue; }
      if (char === ',' && !inQuotes) { values.push(current.trim()); current = ''; continue; }
      current += char;
    }
    values.push(current.trim());
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
  });
}


export const importRoutes: FastifyPluginAsync = async (app) => {
  app.post('/stops/import', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };

    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'No file uploaded' });

    const buf = await data.toBuffer();
    const rows = parseCsv(buf.toString('utf-8'));

    if (rows.length === 0) return reply.code(400).send({ error: 'CSV is empty or has no data rows' });
    if (rows.length > 500) return reply.code(400).send({ error: 'Max 500 rows per import' });

    // Resolve a route to attach stops to — scoped to this org via plans join
    const [existingRoute] = await db
      .select({ id: routes.id })
      .from(routes)
      .innerJoin(plans, and(eq(routes.planId, plans.id), eq(plans.orgId, orgId), isNull(plans.deletedAt)))
      .where(and(isNull(routes.deletedAt), eq(routes.status, 'pending')))
      .limit(1);

    let routeId = existingRoute?.id;
    if (!routeId) {
      const [depot] = await db.select({ id: depots.id }).from(depots).limit(1);
      if (!depot) return reply.code(400).send({ error: 'No depot configured. Set up a depot first.' });
      const today = todayInTz();
      const [plan] = await db.insert(plans).values({ orgId, depotId: depot.id, date: today }).returning();
      const [newRoute] = await db.insert(routes).values({ planId: plan.id }).returning();
      routeId = newRoute.id;
    }

    const errors: Array<{ row: number; field: string; message: string }> = [];
    const warnings: Array<{ row: number; message: string }> = [];

    type StopInsert = typeof stops.$inferInsert;
    const toInsert: StopInsert[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;

      if (!row.address) { errors.push({ row: rowNum, field: 'address', message: 'address is required' }); continue; }
      if (!row.recipientname) { errors.push({ row: rowNum, field: 'recipientName', message: 'recipientName is required' }); continue; }

      let lat = row.lat ? parseFloat(row.lat) : NaN;
      let lng = row.lng ? parseFloat(row.lng) : NaN;

      if (isNaN(lat) || isNaN(lng)) {
        const geo = await geocodeAddress(row.address);
        lat = geo.lat;
        lng = geo.lng;
        if (!geo.ok) warnings.push({ row: rowNum, message: `Could not geocode "${row.address}" — coordinates set to 0,0` });
      }

      toInsert.push({
        routeId,
        orgId,
        recipientName: row.recipientname,
        recipientPhone: row.recipientphone ?? '',
        address: row.address,
        deliveryNotes: row.notes || undefined,
        lat,
        lng,
        rxNumbers: row.rxnumber ? [row.rxnumber] : [],
        controlledSubstance: row.iscontrolled === 'true' || row.iscontrolled === '1',
        windowStart: row.windowstart ? new Date(row.windowstart) : undefined,
        windowEnd: row.windowend ? new Date(row.windowend) : undefined,
        status: 'pending',
        sequenceNumber: row.priority ? parseInt(row.priority) || 0 : 0,
      });
    }

    if (toInsert.length === 0) return reply.code(400).send({ error: 'No valid rows to import', errors });

    const inserted = await db.insert(stops).values(toInsert).returning({ id: stops.id });

    return reply.code(201).send({ imported: inserted.length, errors, warnings });
  });
};
