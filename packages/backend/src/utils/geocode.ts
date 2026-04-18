/**
 * Geocodes an address. Tries Google Maps first (if GOOGLE_MAPS_API_KEY set),
 * then falls back to Nominatim/OpenStreetMap (free, no key required).
 */
export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number; ok: boolean }> {
  // Try Google Maps first
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  if (googleKey) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${googleKey}`;
      const res = await fetch(url);
      const data = await res.json() as { status: string; results: Array<{ geometry: { location: { lat: number; lng: number } } }> };
      if (data.status === 'OK' && data.results[0]) {
        const { lat, lng } = data.results[0].geometry.location;
        return { lat, lng, ok: true };
      }
    } catch { /* fall through to Nominatim */ }
  }

  // Nominatim/OpenStreetMap fallback — free, no key required
  // ToS: max 1 req/sec, must include User-Agent identifying the application
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&addressdetails=0`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MyDashRx/1.0 (pharmacy-delivery; contact@mydashrx.com)' },
    });
    const data = await res.json() as Array<{ lat: string; lon: string }>;
    if (data[0]) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), ok: true };
    }
  } catch { /* fall through */ }

  return { lat: 0, lng: 0, ok: false };
}
