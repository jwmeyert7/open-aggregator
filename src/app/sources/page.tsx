import Link from "next/link";
import { sourceSlug } from "./shared";
import { SourcesTable, type SourceRow, type SourceType } from "./SourcesTable";
import { effectiveFeeds, loadSiteConfig } from "@/lib/config";
import { isMediaFeed } from "@/lib/feeds";
import { liveClusters } from "@/lib/rank";
import { loadState } from "@/lib/state";
import { siteIdentity, writersPublic } from "@/lib/site";
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
  const rows = new Map<string, { count: number; types: Set<SourceType>; sections: Map<string, number>; hint?: string }>();
  const row = (name: string) => {
    const r = rows.get(name) ?? { count: 0, types: new Set<SourceType>(), sections: new Map<string, number>() };
    rows.set(name, r);
    return r;
  };
  const tally = (name: string, section: string | undefined) => {
    if (!section || section === "general") return;
    const r = rows.get(name);
    if (r) r.sections.set(section, (r.sections.get(section) ?? 0) + 1);
  };
  for (const feed of feeds.filter((f) => !isMediaFeed(f))) {
    const days = state.sourceStats?.[feed.id] ?? {};
    const count = Object.entries(days).reduce((sum, [day, s]) => (day >= cutoff ? sum + s.accepted : sum), 0);
    const r = row(feed.name);
    r.count += count;
    r.types.add(sourceType(feed));
    if (feed.sectionHint) r.hint = feed.sectionHint;
  }
  // shows count the episodes that reached the site in the window
  for (const feed of feeds.filter((f) => isMediaFeed(f))) {
    const r = row(feed.name);
    r.types.add("podcast");
    if (feed.sectionHint) r.hint = feed.sectionHint;
  }
  for (const m of state.mediaItems ?? []) {
    if (m.hidden || m.publishedAt.slice(0, 10) < cutoff) continue;
    const r = rows.get(m.sourceName);
    if (r) r.count += 1;
    tally(m.sourceName, m.section);
  }
  // where each source's articles actually filed: every link that joined a
  // live story in the window counts toward that story's section
  for (const c of liveClusters(state)) {
    if (c.mergedInto) continue;
    for (const l of c.links) if (l.addedAt.slice(0, 10) >= cutoff) tally(l.sourceName, c.section);
  }
  const tableRows: SourceRow[] = [...rows.entries()].map(([name, r]) => ({
    name,
    slug: sourceSlug(name),
    count: r.count,
    types: [...r.types],
    sections:
      r.sections.size > 0
        ? [...r.sections.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s)
        : r.hint
          ? [`(${r.hint})`]
          : [],
  }));

  return (
    <main className="wrap page single roomy">
      <div className="prose">
        <h1>Sources</h1>
        <p>
          {siteIdentity().siteName} reads a hand-picked whitelist of sources: team blogs, release feeds, forums,
          podcast shows, primary sources, and news outlets.
          {writersPublic() ? (
            <>
              {" "}
              The people behind the articles have pages of their own on <Link href="/by">Writers</Link>.
            </>
          ) : null}
        </p>
        <SourcesTable rows={tableRows} sectionOrder={loadSiteConfig().sections.map((s) => s.id)} />
        <p className="sources-foot">
          What gets a source onto this list is described in the <a href="/criteria">criteria</a>. Think something
          belongs here? Suggest it via <a href="/submit">submit</a>.
        </p>
      </div>
    </main>
  );
}
