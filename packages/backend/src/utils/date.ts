/**
 * Returns today's date as YYYY-MM-DD in the given IANA timezone.
 * Defaults to America/New_York (current deployment target).
 * Pass org.timezone when available for multi-timezone correctness.
 */
export const todayInTz = (tz = 'America/New_York'): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
