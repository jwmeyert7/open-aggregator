"use client";

import { useRouter } from "next/navigation";

/**
 * Native date input that jumps to the weekly edition covering the picked day.
 * Weeks run Saturday through Friday and are keyed by their end date, so the
 * covering week is the earliest end date within six days at or after the pick.
 * A pick in a publishing gap falls back to the nearest earlier week, then the
 * first later one, so the picker can never land on an empty page.
 */
export function WeekPickerJump({ ends }: { ends: string[] }) {
  const router = useRouter();
  if (ends.length === 0) return null;
  const sorted = [...ends].sort(); // oldest first

  function weekStart(end: string): string {
    const d = new Date(`${end}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 6);
    return d.toISOString().slice(0, 10);
  }

  function go(value: string) {
    if (!value) return;
    const dest =
      sorted.find((end) => end >= value && weekStart(end) <= value) ??
      [...sorted].reverse().find((end) => end < value) ??
      sorted[0];
    if (dest) router.push(`/week/${dest}`);
  }

  return (
    <label className="day-select">
      <span>Pick a day in the week</span>
      <input
        className="text"
        type="date"
        min={weekStart(sorted[0])}
        max={sorted[sorted.length - 1]}
        onChange={(e) => go(e.target.value)}
      />
    </label>
  );
}
