// P-SES15: IP geolocation for country-change login detection
// P-SEC38: HTTPS-only — ip-api.com plaintext HTTP was HIPAA §164.312(e)(2)(ii) violation (IP = quasi-identifier)
// Primary: ipapi.co (HTTPS, 30k/day free). Fallback: api.country.is (HTTPS, no key).
// HIPAA: only country code is stored, not full IP location data.

const CC_RE = /^[A-Z]{2}$/;

async function fetchWithTimeout(url: string, ms = 2000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

export async function lookupCountry(ip: string): Promise<string | null> {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
    return null;
  }
  // Primary: ipapi.co — returns plain 2-letter country code
  try {
    const res = await fetchWithTimeout(`https://ipapi.co/${ip}/country/`);
    if (res.ok) {
      const cc = (await res.text()).trim();
      if (CC_RE.test(cc)) return cc;
    }
  } catch { /* fall through to backup */ }
  // Fallback: api.country.is — returns { ip, country }
  try {
    const res = await fetchWithTimeout(`https://api.country.is/${ip}`);
    if (res.ok) {
      const data = await res.json() as { country?: string };
      if (data.country && CC_RE.test(data.country)) return data.country;
    }
  } catch { /* non-blocking */ }
  return null;
}
