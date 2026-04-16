import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { leadProspects, leadOutreachLog, users } from '../db/schema.js';
import { eq, and, isNull, ilike, or, sql, desc } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';

// ─── Types ────────────────────────────────────────────────────────────────────
interface GooglePlaceResult {
  place_id: string;
  name: string;
  formatted_address: string;
  formatted_phone_number?: string;
  website?: string;
  rating?: number;
  user_ratings_total?: number;
  geometry?: { location: { lat: number; lng: number } };
}

const CHAIN_KEYWORDS = ['cvs', 'walgreens', 'rite aid', 'walmart', 'kroger', 'meijer'];

function calcLeadScore(place: GooglePlaceResult): number {
  let score = 0;
  const name = place.name.toLowerCase();
  if (!CHAIN_KEYWORDS.some(c => name.includes(c))) score += 30;
  if (place.rating && place.rating < 3.5) score += 20;
  if (place.user_ratings_total && place.user_ratings_total < 20) score += 15;
  if (!place.website) score += 15;
  if (place.formatted_address?.includes('MI')) score += 20;
  return Math.min(score, 100);
}

function parseCityState(address: string): { city: string; state: string; zip: string } {
  // "123 Main St, Detroit, MI 48201, USA"
  const parts = address.split(',').map(s => s.trim());
  const city = parts[1] ?? '';
  const stateZip = parts[2] ?? '';
  const stateMatch = stateZip.match(/([A-Z]{2})\s*(\d{5})?/);
  return { city, state: stateMatch?.[1] ?? 'MI', zip: stateMatch?.[2] ?? '' };
}

// ─── Routes ───────────────────────────────────────────────────────────────────
export const leadFinderRoutes: FastifyPluginAsync = async (app) => {
  const auth = requireRole('dispatcher', 'pharmacy_admin', 'super_admin');

  // GET /orgs/:orgId/leads/stats
  app.get('/stats', { preHandler: auth }, async (req) => {
    const { orgId } = req.params as { orgId: string };

    const counts = await db
      .select({ status: leadProspects.status, cnt: sql<number>`count(*)::int` })
      .from(leadProspects)
      .where(and(eq(leadProspects.orgId, orgId), isNull(leadProspects.deletedAt)))
      .groupBy(leadProspects.status);

    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const r of counts) { byStatus[r.status] = r.cnt; total += r.cnt; }

    const closed = byStatus['closed'] ?? 0;
    const lost = byStatus['lost'] ?? 0;
    const conversionRate = (closed + lost) > 0
      ? Math.round((closed / (closed + lost)) * 1000) / 10
      : 0;

    return { total, byStatus, conversionRate };
  });

  // GET /orgs/:orgId/leads/pipeline
  app.get('/pipeline', { preHandler: auth }, async (req) => {
    const { orgId } = req.params as { orgId: string };

    const leads = await db
      .select()
      .from(leadProspects)
      .where(and(eq(leadProspects.orgId, orgId), isNull(leadProspects.deletedAt)))
      .orderBy(desc(leadProspects.score));

    const pipeline: Record<string, typeof leads> = {
      new: [], contacted: [], interested: [], negotiating: [], closed: [], lost: [],
    };
    for (const l of leads) pipeline[l.status]?.push(l);

    return pipeline;
  });

  // GET /orgs/:orgId/leads
  app.get('/', { preHandler: auth }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const { status, city, search, page = '1', limit = '25' } = req.query as {
      status?: string; city?: string; search?: string; page?: string; limit?: string;
    };

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [eq(leadProspects.orgId, orgId), isNull(leadProspects.deletedAt)];
    if (status) conditions.push(eq(leadProspects.status, status as any));
    if (city) conditions.push(ilike(leadProspects.city, `%${city}%`));
    if (search) conditions.push(
      or(ilike(leadProspects.name, `%${search}%`), ilike(leadProspects.city, `%${search}%`))!
    );

    const where = and(...conditions);

    const [leads, [{ total }]] = await Promise.all([
      db.select().from(leadProspects).where(where)
        .orderBy(desc(leadProspects.score))
        .limit(limitNum).offset(offset),
      db.select({ total: sql<number>`count(*)::int` }).from(leadProspects).where(where),
    ]);

    return { leads, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) };
  });

  // POST /orgs/:orgId/leads
  app.post('/', { preHandler: auth }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = req.body as {
      name: string; address: string; city: string; state?: string; zip?: string;
      phone?: string; website?: string; email?: string; ownerName?: string;
      businessType?: string; notes?: string;
    };

    if (!body.name || !body.address || !body.city) {
      return reply.code(400).send({ error: 'name, address, city are required' });
    }

    const [lead] = await db.insert(leadProspects).values({
      orgId, ...body, state: body.state ?? 'MI',
    }).returning();

    return reply.code(201).send(lead);
  });

  // GET /orgs/:orgId/leads/:leadId
  app.get('/:leadId', { preHandler: auth }, async (req, reply) => {
    const { orgId, leadId } = req.params as { orgId: string; leadId: string };

    const [lead] = await db.select().from(leadProspects)
      .where(and(eq(leadProspects.id, leadId), eq(leadProspects.orgId, orgId), isNull(leadProspects.deletedAt)));

    if (!lead) return reply.code(404).send({ error: 'Lead not found' });

    const outreach = await db.select({
      id: leadOutreachLog.id,
      channel: leadOutreachLog.channel,
      subject: leadOutreachLog.subject,
      body: leadOutreachLog.body,
      sentAt: leadOutreachLog.sentAt,
      status: leadOutreachLog.status,
      resendMessageId: leadOutreachLog.resendMessageId,
      sentByName: users.name,
    })
      .from(leadOutreachLog)
      .leftJoin(users, eq(leadOutreachLog.sentBy, users.id))
      .where(eq(leadOutreachLog.leadId, leadId))
      .orderBy(desc(leadOutreachLog.sentAt));

    return { lead, outreach };
  });

  // PATCH /orgs/:orgId/leads/:leadId
  app.patch('/:leadId', { preHandler: auth }, async (req, reply) => {
    const { orgId, leadId } = req.params as { orgId: string; leadId: string };
    const body = req.body as {
      status?: string; notes?: string; assignedTo?: string;
      nextFollowUp?: string; email?: string; phone?: string;
      ownerName?: string; businessType?: string; tags?: unknown[];
    };

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.status !== undefined) updates.status = body.status;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.assignedTo !== undefined) updates.assignedTo = body.assignedTo;
    if (body.nextFollowUp !== undefined) updates.nextFollowUp = body.nextFollowUp ? new Date(body.nextFollowUp) : null;
    if (body.email !== undefined) updates.email = body.email;
    if (body.phone !== undefined) updates.phone = body.phone;
    if (body.ownerName !== undefined) updates.ownerName = body.ownerName;
    if (body.businessType !== undefined) updates.businessType = body.businessType;
    if (body.tags !== undefined) updates.tags = JSON.stringify(body.tags);

    const [lead] = await db.update(leadProspects)
      .set(updates as any)
      .where(and(eq(leadProspects.id, leadId), eq(leadProspects.orgId, orgId), isNull(leadProspects.deletedAt)))
      .returning();

    if (!lead) return reply.code(404).send({ error: 'Lead not found' });
    return lead;
  });

  // DELETE /orgs/:orgId/leads/:leadId
  app.delete('/:leadId', { preHandler: auth }, async (req, reply) => {
    const { orgId, leadId } = req.params as { orgId: string; leadId: string };

    const [lead] = await db.update(leadProspects)
      .set({ deletedAt: new Date() })
      .where(and(eq(leadProspects.id, leadId), eq(leadProspects.orgId, orgId), isNull(leadProspects.deletedAt)))
      .returning();

    if (!lead) return reply.code(404).send({ error: 'Lead not found' });
    return reply.code(204).send();
  });

  // POST /orgs/:orgId/leads/search-places
  app.post('/search-places', { preHandler: auth }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const { city, state = 'MI', radius = 10, query } = req.body as {
      city: string; state?: string; radius?: number; query?: string;
    };

    if (!city) return reply.code(400).send({ error: 'city is required' });

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return reply.code(503).send({ error: 'Google Places API key not configured' });

    const searchQuery = encodeURIComponent(query ?? `pharmacy in ${city}, ${state}`);
    const radiusMeters = (radius ?? 10) * 1609;
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${searchQuery}&radius=${radiusMeters}&key=${apiKey}`;

    const gRes = await fetch(url);
    if (!gRes.ok) return reply.code(502).send({ error: 'Google Places API error' });

    const gData = await gRes.json() as { results: GooglePlaceResult[]; status: string };
    if (gData.status !== 'OK' && gData.status !== 'ZERO_RESULTS') {
      return reply.code(502).send({ error: `Google Places: ${gData.status}` });
    }

    // Fetch existing placeIds for this org to detect duplicates
    const existingPlaceIds = new Set(
      (await db.select({ pid: leadProspects.googlePlaceId })
        .from(leadProspects)
        .where(and(eq(leadProspects.orgId, orgId), isNull(leadProspects.deletedAt))))
        .map(r => r.pid)
        .filter(Boolean)
    );

    const results = [];
    let imported = 0;
    let skipped = 0;

    for (const place of gData.results ?? []) {
      const alreadyExists = existingPlaceIds.has(place.place_id);
      const { city: pCity, state: pState, zip: pZip } = parseCityState(place.formatted_address ?? '');
      const score = calcLeadScore(place);

      results.push({
        googlePlaceId: place.place_id,
        name: place.name,
        address: place.formatted_address,
        city: pCity,
        state: pState,
        zip: pZip,
        phone: place.formatted_phone_number ?? null,
        website: place.website ?? null,
        rating: place.rating ?? null,
        reviewCount: place.user_ratings_total ?? null,
        score,
        alreadyImported: alreadyExists,
      });

      if (alreadyExists) { skipped++; } else { imported++; }
    }

    return { results, imported, skipped };
  });

  // POST /orgs/:orgId/leads/:leadId/outreach
  app.post('/:leadId/outreach', { preHandler: auth }, async (req, reply) => {
    const { orgId, leadId } = req.params as { orgId: string; leadId: string };
    const { subject, body: emailBody, fromName } = req.body as {
      subject: string; body: string; fromName?: string;
    };

    if (!subject || !emailBody) return reply.code(400).send({ error: 'subject and body are required' });

    const [lead] = await db.select().from(leadProspects)
      .where(and(eq(leadProspects.id, leadId), eq(leadProspects.orgId, orgId), isNull(leadProspects.deletedAt)));

    if (!lead) return reply.code(404).send({ error: 'Lead not found' });
    if (!lead.email) return reply.code(400).send({ error: 'No email on file for this lead' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
      return reply.code(400).send({ error: 'Invalid email address on file for this lead' });
    }

    const resendKey = process.env.RESEND_API_KEY;
    const senderDomain = process.env.SENDER_DOMAIN;
    if (!resendKey || !senderDomain) return reply.code(503).send({ error: 'Email service not configured' });

    const payload = req.user as { sub?: string };
    const sentBy = payload?.sub ?? null;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: `${fromName ?? 'MyDashRx Team'} <outreach@${senderDomain}>`,
        to: [lead.email],
        subject,
        html: emailBody,
      }),
    });

    let resendMessageId: string | null = null;
    let emailStatus = 'sent';

    if (resendRes.ok) {
      const resendData = await resendRes.json() as { id?: string };
      resendMessageId = resendData.id ?? null;
    } else {
      emailStatus = 'failed';
    }

    const [log] = await db.insert(leadOutreachLog).values({
      leadId,
      orgId,
      channel: 'email',
      subject,
      body: emailBody,
      sentBy,
      resendMessageId,
      status: emailStatus,
    }).returning();

    await db.update(leadProspects)
      .set({ lastContactedAt: new Date(), updatedAt: new Date() })
      .where(eq(leadProspects.id, leadId));

    return { log, messageId: resendMessageId, status: emailStatus };
  });
};
