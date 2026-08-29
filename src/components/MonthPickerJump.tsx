"use client";

import { useRouter } from "next/navigation";

/**
 * Native month input constrained to months that have a monthly edition. A pick
 * in a gap falls back to the nearest earlier month, then the first later one,
 * so the picker can never land on an empty page.
 */
export function MonthPickerJump({ months }: { months: string[] }) {
  const router = useRouter();
  if (months.length === 0) return null;
  const sorted = [...months].sort(); // oldest first

  function go(value: string) {
    if (!value) return;
    const dest = sorted.includes(value)
      ? value
      : ([...sorted].reverse().find((m) => m < value) ?? sorted.find((m) => m > value));
    if (dest) router.push(`/month/${dest}`);
  }

  return (
    <label className="day-select">
      <span>Pick a month</span>
      <input
        className="text"
        type="month"
        min={sorted[0]}
        max={sorted[sorted.length - 1]}
        onChange={(e) => go(e.target.value)}
      />
    </label>
  );
}
