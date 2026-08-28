import { siteUrl } from "@/lib/config";
import { liveClusters } from "@/lib/rank";
import { siteIdentity } from "@/lib/site";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * The site's own RSS feed: the newest stories with their headline, explainer,
 * section, and story-page permalink. GUIDs are the cluster ids and pubDate is
 * the story's creation, both stable across pipeline runs, so a reader never
 * sees an item re-dated. Headlines and explainers may still refresh in place
 * as a story develops, matching the site.
 */
export async function GET() {
  const state = await loadState();
  const base = siteUrl();
  const site = siteIdentity();
  const stories = liveClusters(state)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 40);
  const items = stories
    .map(
      (c) => `    <item>
      <title>${esc(c.headline)}</title>
      <link>${esc(`${base}/story/${c.slug}`)}</link>
      <guid isPermaLink="false">${esc(c.id)}</guid>
      <pubDate>${new Date(c.createdAt).toUTCString()}</pubDate>
      <category>${esc(c.section)}</category>
      <description>${esc(c.explainer)}</description>
    </item>`
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(site.siteName)}</title>
    <link>${esc(base)}</link>
    <description>${esc(`${site.tagline}. The top ${site.topic} stories as they develop, aggregated from a curated whitelist of sources.`)}</description>
    <atom:link href="${esc(`${base}/feed.xml`)}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
