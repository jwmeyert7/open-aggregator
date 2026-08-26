import { sourceSlug } from "./shared";
import { SourcesTable } from "./SourcesTable";
import { effectiveFeeds } from "@/lib/config";
import { isMediaFeed } from "@/lib/feeds";
import { loadState } from "@/lib/state";
import { siteIdentity } from "@/lib/site";
import { utcDay } from "@/lib/util";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sources",
  description: "Every source this site reads, and how much of the last month's news came from each.",
};

export default async function SourcesPage() {
  const state = await loadState();
  const feeds = effectiveFeeds(state);
  const cutoff = utcDay(new Date(Date.now() - 30 * 24 * 60 * 60000).toISOString());

  // the podcast shows live in their own table below the news sources
  const newsFeeds = feeds.filter((f) => !isMediaFeed(f));
  const showFeeds = feeds.filter((f) => isMediaFeed(f));

  // one row per display name (a few outlets are read through two feeds)
  const rows = new Map<string, { count: number }>();
  for (const feed of newsFeeds) {
    const days = state.sourceStats?.[feed.id] ?? {};
    const count = Object.entries(days).reduce((sum, [day, s]) => (day >= cutoff ? sum + s.accepted : sum), 0);
    const row = rows.get(feed.name);
    if (row) row.count += count;
    else rows.set(feed.name, { count });
  }
  const sorted = [...rows.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));

  // one row per show name, counting episodes that reached the site in the window
  const showCounts = new Map<string, number>();
  for (const f of showFeeds) if (!showCounts.has(f.name)) showCounts.set(f.name, 0);
  for (const m of state.mediaItems ?? []) {
    if (m.hidden || m.publishedAt.slice(0, 10) < cutoff) continue;
    if (showCounts.has(m.sourceName)) showCounts.set(m.sourceName, (showCounts.get(m.sourceName) ?? 0) + 1);
  }
  const shows = [...showCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));


  return (
    <main className="wrap page single roomy">
      <div className="prose">
        <h1>Sources</h1>
        <p>
          {siteIdentity().siteName} reads a hand-picked whitelist of sources. This is the whole list. The number is
          how many of each source&apos;s items were published to the site in the last 30 days. Click a source to see
          its articles here.
        </p>
        <p className="org">
          On this page: <a href="#news">news sources</a> · <a href="#podcasts">podcast shows</a>
        </p>
        <h2 id="news">News sources</h2>
        <SourcesTable rows={sorted.map(([name, r]) => ({ name, slug: sourceSlug(name), count: r.count }))} />
        {shows.length > 0 ? (
          <>
            <h2 id="podcasts">Podcast shows</h2>
            <p>
              Episodes from these shows land on the <a href="/podcasts">podcasts page</a> and beside the news on the
              front page. A show that covers more than the site&apos;s topic faces a per-episode gate, so only its
              on-topic episodes appear. The number is how many episodes reached the site in the last 30 days.
            </p>
            <SourcesTable
              rows={shows.map(([name, count]) => ({ name, slug: sourceSlug(name), count }))}
              nameHeader="Show"
              countHeader="Episodes, last 30 days"
            />
          </>
        ) : null}

        <p className="sources-foot">
          What gets a source onto this list is described in the <a href="/criteria">criteria</a>. Think something
          belongs here? Suggest it via <a href="/submit">submit</a>.
        </p>
      </div>
    </main>
  );
}
