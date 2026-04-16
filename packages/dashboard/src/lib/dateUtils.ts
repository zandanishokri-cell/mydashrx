/** Returns d (default: now) as YYYY-MM-DD in browser local time. */
export const localDateStr = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
