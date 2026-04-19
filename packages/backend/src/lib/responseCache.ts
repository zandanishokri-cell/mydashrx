/**
 * P-PERF4: LRU analytics cache — 60s TTL per org.
 * Analytics fires 13 parallel DB queries per call; this eliminates repeated fan-out
 * for the same org within a polling window.
 *
 * Cache key format: `analytics:${orgId}` / `delivery-performance:${orgId}`
 * TTL: 60 seconds
 * Max entries: 500 (bounded by org count)
 * Invalidate on stop status PATCH (cache.del called from stops route)
 *
 * P-PERF14: LRU dashboard/combined cache — 15s TTL per org (matches poll interval).
 * A 4-staff pharmacy fires ~34K DB queries/month from idle 30s polling; cache hits
 * reduce that to near-zero. GPS/map variant uses 5s TTL (position freshness required).
 * Stale-while-revalidate: serve cached value immediately, refresh in background via setImmediate.
 */
import { LRUCache } from 'lru-cache';

const ANALYTICS_TTL_MS = 60_000;
const DASHBOARD_TTL_MS = 15_000;
const DASHBOARD_MAP_TTL_MS = 5_000;
const MAX_ENTRIES = 500;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const analyticsCache = new LRUCache<string, any>({
  max: MAX_ENTRIES,
  ttl: ANALYTICS_TTL_MS,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const dashboardCache = new LRUCache<string, any>({
  max: MAX_ENTRIES,
  ttl: DASHBOARD_TTL_MS,
});

export const analyticsKey = (orgId: string, query: Record<string, string | undefined>) =>
  `analytics:${orgId}:${new URLSearchParams(Object.entries(query).filter(([, v]) => v != null) as [string, string][]).toString()}`;

export const deliveryPerfKey = (orgId: string, query: Record<string, string | undefined>) =>
  `delivery-performance:${orgId}:${new URLSearchParams(Object.entries(query).filter(([, v]) => v != null) as [string, string][]).toString()}`;

/** Dashboard combined cache key. GPS/map variant (?fields=map) uses shorter TTL. */
export const dashboardCombinedKey = (orgId: string, query: Record<string, string | undefined>) =>
  `dashboard:${orgId}:${new URLSearchParams(Object.entries(query).filter(([, v]) => v != null) as [string, string][]).toString()}`;

/** Invalidate all analytics cache entries for an org (call on stop status change). */
export function invalidateAnalytics(orgId: string): void {
  for (const k of analyticsCache.keys()) {
    if (k.startsWith(`analytics:${orgId}:`) || k.startsWith(`delivery-performance:${orgId}:`)) {
      analyticsCache.delete(k);
    }
  }
}

/** P-PERF14: Invalidate all dashboard cache entries for an org (call alongside invalidateAnalytics on stop status change). */
export function invalidateDashboard(orgId: string): void {
  for (const k of dashboardCache.keys()) {
    if (k.startsWith(`dashboard:${orgId}:`)) {
      dashboardCache.delete(k);
    }
  }
}

/**
 * P-PERF14: Stale-while-revalidate wrapper for dashboard cache.
 * Serves cached value immediately; schedules background refresh via setImmediate.
 * isMapVariant=true uses 5s TTL for GPS accuracy.
 */
export function getDashboardCached<T>(
  key: string,
  isMapVariant: boolean,
  fetcher: () => Promise<T>,
): T | null {
  const cached = dashboardCache.get(key) as T | undefined;
  if (cached !== undefined) {
    // Stale-while-revalidate: refresh in background after serving cache
    setImmediate(() => {
      fetcher().then(fresh => {
        dashboardCache.set(key, fresh, { ttl: isMapVariant ? DASHBOARD_MAP_TTL_MS : DASHBOARD_TTL_MS });
      }).catch(() => {});
    });
    return cached;
  }
  return null;
}

/** P-PERF14: Store dashboard result with appropriate TTL. */
export function setDashboardCached<T>(key: string, value: T, isMapVariant: boolean): void {
  dashboardCache.set(key, value, { ttl: isMapVariant ? DASHBOARD_MAP_TTL_MS : DASHBOARD_TTL_MS });
}
