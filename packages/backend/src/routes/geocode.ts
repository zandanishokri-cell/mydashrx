import type { FastifyPluginAsync } from 'fastify';

interface PlacesAutocompleteResponse {
  status: string;
  predictions?: Array<{
    description: string;
    place_id: string;
    structured_formatting?: { main_text?: string; secondary_text?: string };
  }>;
}

export const geocodeRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/geocode/autocomplete?q=... — address predictions (server-side key proxy)
  app.get('/autocomplete', async (req, reply) => {
    try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }

    const { q, country } = req.query as { q?: string; country?: string };
    const term = (q ?? '').trim();
    if (term.length < 3) return { predictions: [] };

    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) return { predictions: [] };

    const params = new URLSearchParams({
      input: term,
      key,
      types: 'address',
      components: `country:${(country ?? 'us').toLowerCase()}`,
    });

    const res = await fetch(`https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`, {
      signal: AbortSignal.timeout(4000),
    }).catch(() => null);
    if (!res?.ok) return { predictions: [] };

    const data = (await res.json()) as PlacesAutocompleteResponse;
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      req.log.warn({ status: data.status }, 'places autocomplete non-ok');
      return { predictions: [] };
    }

    return {
      predictions: (data.predictions ?? []).slice(0, 6).map(p => ({
        description: p.description,
        placeId: p.place_id,
        mainText: p.structured_formatting?.main_text ?? p.description,
        secondaryText: p.structured_formatting?.secondary_text ?? '',
      })),
    };
  });
};
