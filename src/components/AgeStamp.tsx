import { timeAgo } from "@/lib/util";

/**
 * Story age with a hue that tells staleness at a glance, keyed to the label
 * the reader sees: peach through "1h ago", regular meta color for the rest of
 * the day's hours, faded from "1d ago" on.
 */
export function AgeStamp({ iso }: { iso: string }) {
  const age = Date.now() - new Date(iso).getTime();
  const cls = age < 2 * 60 * 60000 ? "fresh-ago" : age < 24 * 60 * 60000 ? "hours-ago" : "days-ago";
  return <span className={cls}>{timeAgo(iso)}</span>;
}
