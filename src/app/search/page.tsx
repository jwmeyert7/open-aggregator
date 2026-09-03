import Link from "next/link";
import { ClusterCard } from "@/components/ClusterCard";
import { byPublished, itemDisplayTitle, liveClusters, rankClusters, score } from "@/lib/rank";
import { loadSiteConfig } from "@/lib/config";
import { loadState } from "@/lib/state";
import { timeAgo, urlMatches } from "@/lib/util";

export const dynamic = "force-dynamic";

export const metadata = { title: "Search", robots: { index: false } };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const state = await loadState();
  const cfg = loadSiteConfig();

  const needle = query.toLowerCase();
  const match = (...fields: Array<string | undefined>) =>
    needle.length > 0 && fields.some((f) => f?.toLowerCase().includes(needle));

  const stories = query
    ? rankClusters(
        liveClusters(state).filter(
          (c) =>
            match(c.headline, c.explainer, ...(c.keywords ?? []), ...c.links.map((l) => l.byline)) ||
            // a pasted link lands on the story that carries it
            c.links.some((l) => urlMatches(l.url, query))
        ),
        cfg.ranking
      ).slice(0, 20)
    : [];
  const storyIds = new Set(stories.map((c) => c.id));
  const items = query
    ? byPublished(state.items)
        .filter((i) => (match(i.title, i.sourceName, i.byline) || urlMatches(i.url, query)) && !(i.clusterId && storyIds.has(i.clusterId)))
        .slice(0, 30)
    : [];

  return (
    <main className="wrap page single">
      <div>
        <div className="section-head">
          <h1>Search</h1>
          <form action="/search" className="search-form-page">
            <input
              className="text"
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Headlines, sources, writers, keywords, or paste a link…"
              autoFocus
            />
            <button className="btn" type="submit">
              Search
            </button>
          </form>
        </div>
        {!query ? null : stories.length === 0 && items.length === 0 ? (
          <p className="empty-state">Nothing found for “{query}” in the last 30 days.</p>
        ) : (
          <>
            {stories.length > 0 ? <h3 className="search-group">Stories</h3> : null}
            {stories.map((c) => (
              <ClusterCard key={c.id} cluster={c} showSection />
            ))}
            {items.length > 0 ? <h3 className="search-group">From the stream</h3> : null}
            {items.length > 0 ? (
              <ul className="search-items">
                {items.map((i) => (
                  <li key={i.id} className="newest-item">
                    <a href={i.url} rel="noopener">
                      {itemDisplayTitle(state, i)}
                    </a>
                    <div className="org">
                      {i.sourceName} · {timeAgo(i.publishedAt)}
                      {i.clusterId && state.clusters[i.clusterId] && !state.clusters[i.clusterId].killed ? (
                        <>
                          {" · "}
                          <Link href={`/story/${state.clusters[i.clusterId].slug}`}>story</Link>
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
