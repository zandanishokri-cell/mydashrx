/**
 * P-PERF19: Query timing instrumentation — HIPAA §164.308(a)(1)(ii)(D)
 * Logs slow queries (>500ms) to aid performance monitoring and capacity planning.
 */

const SLOW_QUERY_MS = 500;

/**
 * Wraps an async DB/query function and logs a warning if it exceeds SLOW_QUERY_MS.
 * Use on critical hot-path queries: /dashboard/combined, /analytics, /routes stops.
 */
export async function timedQuery<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    const elapsed = Date.now() - start;
    if (elapsed > SLOW_QUERY_MS) {
      console.warn(JSON.stringify({
        event: 'slow_query',
        label,
        elapsed_ms: elapsed,
        ts: new Date().toISOString(),
      }));
    }
  }
}
