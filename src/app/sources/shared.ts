import type { FeedConfig } from "@/lib/types";

/**
 * A reader-facing link for a source: its site, never its feed machinery.
 * Editorial internals (tiers, weights, gate rates) stay private on purpose.
 */
export function sourceLink(feed: FeedConfig): string {
  if (feed.type === "farcaster") {
    return `https://farcaster.xyz/~/channel/${feed.url.replace(/^channel:/, "")}`;
  }
  if (feed.type === "gnews") {
    // the feed is a Google News query scoped to one outlet: link the outlet
    const site = /site:([a-z0-9.-]+)/i.exec(feed.url)?.[1];
    if (site) return `https://${site}`;
  }
  if (feed.type === "youtube") {
    // the feed URL is RSS machinery: link the channel (or playlist) itself
    const channel = /channel_id=(UC[\w-]{22})/.exec(feed.url)?.[1];
    if (channel) return `https://www.youtube.com/channel/${channel}`;
    const playlist = /playlist_id=([\w-]+)/.exec(feed.url)?.[1];
    if (playlist) return `https://www.youtube.com/playlist?list=${playlist}`;
  }
  try {
    return new URL(feed.url).origin;
  } catch {
    return feed.url;
  }
}

/** URL segment for a source's on-site page, derived from its display name. */
export function sourceSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
