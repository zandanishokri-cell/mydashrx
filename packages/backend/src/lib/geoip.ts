// P-ML24: IP geolocation utility — ip-api.com free tier (45 req/min, no key needed)
// Fail-open: any error/timeout → null → geo check skipped, auth proceeds normally

export interface GeoResult { country: string; lat: number; lon: number; }

export async function lookupIp(ip: string): Promise<GeoResult | null> {
  if (!ip || ip === '127.0.0.1' || ip.startsWith('::') || ip.startsWith('10.') || ip.startsWith('192.168.')) return null;
  try {
    const res = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,countryCode,lat,lon`,
      { signal: AbortSignal.timeout(1500) }
    );
    if (!res.ok) return null;
    const d = await res.json() as { status: string; countryCode: string; lat: number; lon: number };
    if (d.status !== 'success' || !/^[A-Z]{2}$/.test(d.countryCode)) return null;
    return { country: d.countryCode, lat: d.lat, lon: d.lon };
  } catch { return null; }
}

// Haversine great-circle distance in km
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
