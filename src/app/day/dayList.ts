/** Days shown on the daily index before the full archive takes over. */
export const RECENT_DAYS = 14;

/** "Thursday, July 23, 2026" from a YYYY-MM-DD UTC day. */
export function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** "July 2026" from a YYYY-MM month key. */
export function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}

/**
 * Group day strings (newest first) into month buckets, newest month first.
 * Only months that actually have days appear, so paging never lands on a gap.
 */
export function monthsWithDays(dates: string[]): Array<{ month: string; days: string[] }> {
  const byMonth = new Map<string, string[]>();
  for (const d of [...dates].sort().reverse()) {
    const key = d.slice(0, 7);
    const bucket = byMonth.get(key);
    if (bucket) bucket.push(d);
    else byMonth.set(key, [d]);
  }
  return [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([month, days]) => ({ month, days }));
}
