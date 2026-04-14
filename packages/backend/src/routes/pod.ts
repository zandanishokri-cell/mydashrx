import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { proofOfDeliveries, stops } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';
import { uploadBuffer } from '../services/storage.js';

export const podRoutes: FastifyPluginAsync = async (app) => {
  // Capture POD (signature, age verification, COD)
  app.post('/', { preHandler: requireRole('driver') }, async (req, reply) => {
    const { stopId } = req.params as { stopId: string };
    const user = req.user as { sub: string };

    const body = req.body as {
      packageCount: number;
      signature?: {
        svgData: string;
        signerName: string;
        lat: number;
        lng: number;
      };
      ageVerification?: {
        verified: boolean;
        idType?: string;
        idLastFour?: string;
        dobConfirmed: boolean;
      };
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
      driverId: user.sub,
      packageCount: body.packageCount,
      signature: body.signature
        ? { ...body.signature, capturedAt: new Date().toISOString() }
        : null,
      photos: [],
      ageVerification: body.ageVerification ?? null,
      codCollected: body.codCollected ?? null,
      driverNote: body.driverNote,
      customerNote: body.customerNote,
    }).returning();

    // Mark stop completed
    await db
      .update(stops)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(stops.id, stopId));

    return reply.code(201).send(pod);
  });

  // Upload photo to an existing POD
  app.post('/photo', { preHandler: requireRole('driver') }, async (req, reply) => {
    const { stopId } = req.params as { stopId: string };
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'No file uploaded' });

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(data.mimetype)) {
      return reply.code(400).send({ error: 'Only JPEG, PNG, WEBP allowed' });
    }

    const buffer = await data.toBuffer();
    const { key, url } = await uploadBuffer(buffer, data.mimetype, `pod/${stopId}`);

    const [existing] = await db
      .select()
      .from(proofOfDeliveries)
      .where(eq(proofOfDeliveries.stopId, stopId))
      .limit(1);

    if (existing) {
      const photos = (existing.photos as Array<{ key: string; url: string; capturedAt: string }>) ?? [];
      photos.push({ key, url, capturedAt: new Date().toISOString() });
      await db
        .update(proofOfDeliveries)
        .set({ photos })
        .where(eq(proofOfDeliveries.stopId, stopId));
    }

    return { key, url };
  });

  // Get POD for a stop (dispatcher/pharmacy)
  app.get('/', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { stopId } = req.params as { stopId: string };
    const [pod] = await db
      .select()
      .from(proofOfDeliveries)
      .where(eq(proofOfDeliveries.stopId, stopId))
      .limit(1);
    if (!pod) return reply.code(404).send({ error: 'No POD found for this stop' });
    return pod;
  });
};
