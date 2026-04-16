/**
 * Geocodes an address using Google Maps Geocoding API.
 * Returns lat/lng=0,0 with ok=false when API key is missing or geocoding fails.
 * Callers should store coordinates and optionally warn when ok=false.
 */
export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number; ok: boolean }> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return { lat: 0, lng: 0, ok: false };
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`;
    const res = await fetch(url);
    const data = await res.json() as { status: string; results: Array<{ geometry: { location: { lat: number; lng: number } } }> };
    if (data.status === 'OK' && data.results[0]) {
      const { lat, lng } = data.results[0].geometry.location;
      return { lat, lng, ok: true };
    }
  } catch { /* network/parse failure — fall through */ }
  return { lat: 0, lng: 0, ok: false };
}
