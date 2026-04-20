// OPUS-AUDIT-14: single source of truth for CSV cell escaping (RFC 4180).
// Always quote the value so commas, quotes, and newlines inside the cell stay inside the cell.
// Embedded double-quotes get doubled ("" means a literal quote inside a quoted field).
// null/undefined collapse to an empty quoted cell; numbers/booleans coerce via String().
export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '""';
  return `"${String(v).replace(/"/g, '""')}"`;
}
