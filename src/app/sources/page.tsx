import { sourceSlug } from "./shared";
import { SourcesTable } from "./SourcesTable";
import { effectiveFeeds } from "@/lib/config";
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

  // one row per display name (a few outlets are read through two feeds)
  const rows = new Map<string, { count: number }>();
  for (const feed of feeds) {
    const days = state.sourceStats?.[feed.id] ?? {};
    const count = Object.entries(days).reduce((sum, [day, s]) => (day >= cutoff ? sum + s.accepted : sum), 0);
    const row = rows.get(feed.name);
    if (row) row.count += count;
    else rows.set(feed.name, { count });
  }
  const sorted = [...rows.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));

  return (
    <main className="wrap page single roomy">
      <div className="prose">
        <h1>Sources</h1>
        <p>
          {siteIdentity().siteName} reads a hand-picked whitelist of sources. This is the whole list. The number is
          how many of each source&apos;s items were published to the site in the last 30 days. Click a source to see
          its articles here.
        </p>
        <SourcesTable rows={sorted.map(([name, r]) => ({ name, slug: sourceSlug(name), count: r.count }))} />
        <p>
          What gets a source onto this list is described in the <a href="/criteria">criteria</a>. Think something
          belongs here? Suggest it via <a href="/submit">submit</a>.
        </p>
      </div>
    </main>
  );
}
