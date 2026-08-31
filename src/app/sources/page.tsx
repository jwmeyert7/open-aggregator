import { sourceSlug } from "./shared";
import { SourcesTable, type SourceRow, type SourceType } from "./SourcesTable";
import { effectiveFeeds } from "@/lib/config";
import { isMediaFeed } from "@/lib/feeds";
import { loadState } from "@/lib/state";
import { siteIdentity } from "@/lib/site";
import { utcDay } from "@/lib/util";
import type { FeedConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sources",
  description: "Every source this site reads, and how much of the last month's news came from each.",
};

/**
 * What kind of source a feed is, for the table's middle column: shows are
 * podcasts, news categories are news, forums are forums, and everything
 * else (team blogs, release feeds, research, tracker sites) is a primary
 * source speaking for itself.
 */
function sourceType(f: FeedConfig): SourceType {
  if (isMediaFeed(f)) return "podcast";
  const cat = (f.category ?? "").toLowerCase();
  if (cat.startsWith("news") || cat === "newsletter") return "news";
  if (cat === "forum" || f.type === "discourse") return "forum";
  return "primary";
}

export default async function SourcesPage() {
  const state = await loadState();
  const feeds = effectiveFeeds(state);
  const cutoff = utcDay(new Date(Date.now() - 30 * 24 * 60 * 60000).toISOString());

  // one row per display name: an outlet read through two feeds is one row,
  // and an outlet that is also a show carries both types
  const rows = new Map<string, { count: number; types: Set<SourceType> }>();
  const row = (name: string) => {
    const r = rows.get(name) ?? { count: 0, types: new Set<SourceType>() };
    rows.set(name, r);
    return r;
  };
  for (const feed of feeds.filter((f) => !isMediaFeed(f))) {
    const days = state.sourceStats?.[feed.id] ?? {};
    const count = Object.entries(days).reduce((sum, [day, s]) => (day >= cutoff ? sum + s.accepted : sum), 0);
    const r = row(feed.name);
    r.count += count;
    r.types.add(sourceType(feed));
  }
  // shows count the episodes that reached the site in the window
  for (const feed of feeds.filter((f) => isMediaFeed(f))) row(feed.name).types.add("podcast");
  for (const m of state.mediaItems ?? []) {
    if (m.hidden || m.publishedAt.slice(0, 10) < cutoff) continue;
    const r = rows.get(m.sourceName);
    if (r) r.count += 1;
  }
  const tableRows: SourceRow[] = [...rows.entries()].map(([name, r]) => ({
    name,
    slug: sourceSlug(name),
    count: r.count,
    types: [...r.types],
  }));

  return (
    <main className="wrap page single roomy">
      <div className="prose">
        <h1>Sources</h1>
        <p>
          {siteIdentity().siteName} reads a hand-picked whitelist of sources: team blogs, release feeds, forums,
          podcast shows, primary sources, and news outlets.
        </p>
        <SourcesTable rows={tableRows} />
        <p className="sources-foot">
          What gets a source onto this list is described in the <a href="/criteria">criteria</a>. Think something
          belongs here? Suggest it via <a href="/submit">submit</a>.
        </p>
      </div>
    </main>
  );
}
