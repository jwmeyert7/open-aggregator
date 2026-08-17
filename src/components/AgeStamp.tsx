import { timeAgo } from "@/lib/util";

/**
 * Story age with a hue that tells staleness at a glance, keyed to the label
 * the reader sees: peach through "1h ago", regular meta color for the rest of
 * the day's hours, faded from "1d ago" on. Anything younger than one
 * pipeline interval just says "new": to a reader that is the honest label,
 * since the site itself only learned of it this run.
 */
export function AgeStamp({ iso }: { iso: string }) {
  const age = Date.now() - new Date(iso).getTime();
  if (age < 15 * 60000) return <span className="fresh-ago new-tag">new</span>;
  const cls = age < 2 * 60 * 60000 ? "fresh-ago" : age < 24 * 60 * 60000 ? "hours-ago" : "days-ago";
  return <span className={cls}>{timeAgo(iso)}</span>;
}
