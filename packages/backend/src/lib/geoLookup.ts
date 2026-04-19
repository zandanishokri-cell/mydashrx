// P-SES15: IP geolocation for country-change login detection
// Uses ip-api.com free tier (45 req/min). 2s timeout. Never throws — returns null on failure.
// HIPAA: only country code is stored, not full IP location data.

export async function lookupCountry(ip: string): Promise<string | null> {
  // Skip for private/loopback IPs
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
    return null;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,countryCode`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json() as { status: string; countryCode?: string };
    return data.status === 'success' ? (data.countryCode ?? null) : null;
  } catch {
    return null; // timeout or network error — non-blocking
  }
}
