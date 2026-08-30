/** Timestamps are ISO-8601 UTC strings everywhere: sortable, and safe to serialise. */
export const now = (): string => new Date().toISOString();

/**
 * Prefixed, time-ordered id. The prefix makes an id self-describing in logs and in
 * URLs (`scr_…` is a screen), and generating it in the process means a row can be
 * built and referenced without a round trip to the database.
 */
export const uid = (prefix = 'id'): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
