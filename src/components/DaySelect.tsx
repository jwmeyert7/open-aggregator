"use client";

import { useRouter } from "next/navigation";

/**
 * Day picker listing only days that actually have content, so a reader can
 * never land on an empty page. "archive" jumps to that day's snapshots,
 * "day" jumps to the frozen daily page.
 */
export function DaySelect({
  days,
  selected,
  target,
}: {
  days: string[];
  selected?: string;
  target: "archive" | "day";
}) {
  const router = useRouter();
  if (days.length === 0) return null;

  return (
    <label className="day-select">
      <span>Jump to day</span>
      <select
        className="select"
        value={selected ?? ""}
        onChange={(e) => {
          const day = e.target.value;
          if (day) router.push(target === "archive" ? `/archive/per-update?date=${day}` : `/day/${day}`);
        }}
      >
        {selected ? null : <option value="">Choose a day</option>}
        {days.map((d) => (
          <option key={d} value={d}>
            {new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
              timeZone: "UTC",
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </option>
        ))}
      </select>
    </label>
  );
}
