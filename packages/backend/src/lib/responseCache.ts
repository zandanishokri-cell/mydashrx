/**
 * P-PERF4: LRU analytics cache — 60s TTL per org.
 * Analytics fires 13 parallel DB queries per call; this eliminates repeated fan-out
 * for the same org within a polling window.
 *
 * Cache key format: `analytics:${orgId}` / `delivery-performance:${orgId}`
 * TTL: 60 seconds
 * Max entries: 500 (bounded by org count)
 * Invalidate on stop status PATCH (cache.del called from stops route)
 */
import { LRUCache } from 'lru-cache';

const ANALYTICS_TTL_MS = 60_000;
const MAX_ENTRIES = 500;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const analyticsCache = new LRUCache<string, any>({
  max: MAX_ENTRIES,
  ttl: ANALYTICS_TTL_MS,
});

export const analyticsKey = (orgId: string, query: Record<string, string | undefined>) =>
  `analytics:${orgId}:${new URLSearchParams(Object.entries(query).filter(([, v]) => v != null) as [string, string][]).toString()}`;

export const deliveryPerfKey = (orgId: string, query: Record<string, string | undefined>) =>
  `delivery-performance:${orgId}:${new URLSearchParams(Object.entries(query).filter(([, v]) => v != null) as [string, string][]).toString()}`;

/** Invalidate all analytics cache entries for an org (call on stop status change). */
export function invalidateAnalytics(orgId: string): void {
  for (const k of analyticsCache.keys()) {
    if (k.startsWith(`analytics:${orgId}:`) || k.startsWith(`delivery-performance:${orgId}:`)) {
      analyticsCache.delete(k);
    }
  }
}
