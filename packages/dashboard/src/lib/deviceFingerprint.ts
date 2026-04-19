// P-ML25: Lightweight deterministic browser fingerprint — FNV-1a 32-bit hash
// No external library, no canvas/WebGL — only stable, privacy-safe browser signals
// Used at magic-link request + confirm to detect device switches (soft ATO signal)

export function collectFingerprint(): string {
  if (typeof navigator === 'undefined') return 'server';
  const attrs = [
    navigator.userAgent,
    navigator.language,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    `${screen.width}x${screen.height}`,
    String(screen.colorDepth),
    String(navigator.hardwareConcurrency ?? ''),
  ];
  return attrs.join('|').split('').reduce((h, c) => {
    h ^= c.charCodeAt(0);
    return Math.imul(h >>> 0, 16777619) >>> 0;
  }, 2166136261).toString(16);
}
