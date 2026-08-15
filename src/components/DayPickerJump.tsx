"use client";

import { useRouter } from "next/navigation";

/**
 * Native date input constrained to the daily archive's range. Picking a date
 * with no digest (a publishing gap) jumps to the nearest earlier day that has
 * one, falling forward only when nothing earlier exists, so the picker can
 * never land on an empty page.
 */
export function DayPickerJump({ days }: { days: string[] }) {
  const router = useRouter();
  if (days.length === 0) return null;
  const sorted = [...days].sort(); // oldest first

  function go(value: string) {
    if (!value) return;
    const dest = sorted.includes(value)
      ? value
      : ([...sorted].reverse().find((d) => d < value) ?? sorted.find((d) => d > value));
    if (dest) router.push(`/day/${dest}`);
  }

  return (
    <label className="day-select">
      <span>Pick a day</span>
      <input
        className="text"
        type="date"
        min={sorted[0]}
        max={sorted[sorted.length - 1]}
        onChange={(e) => go(e.target.value)}
      />
    </label>
  );
}
