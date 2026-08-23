import { StoriesClient, type StoriesData } from "./StoriesClient";
import { buildChrome, NotLoggedIn } from "../server";
import { isAdmin } from "@/lib/auth";
import { loadSiteConfig } from "@/lib/config";
import { liveClusters, rankClusters, score, scoreBreakdown, topStories } from "@/lib/rank";
import { siteIdentity } from "@/lib/site";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin · Stories", robots: { index: false } };

export default async function AdminStoriesPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter } = await searchParams;
  if (!(await isAdmin())) return <NotLoggedIn />;

  const state = await loadState();
  const cfg = loadSiteConfig();
  const now = new Date();
  // every live story ships to this page: the client shows a short list until
  // the filter box is used, and a merge or filter must be able to reach a
  // story however old and low it ranks
  const ranked = rankClusters(liveClusters(state), cfg.ranking, now);
  const topIds = topStories(state, cfg.ranking, now).map((c) => c.id);
  const sectionRanks = new Map<string, number>();
  for (const s of cfg.sections) {
    rankClusters(liveClusters(state).filter((c) => c.section === s.id), cfg.ranking, now).forEach((c, i) =>
      sectionRanks.set(c.id, i + 1)
    );
  }

  const data: StoriesData = {
    sections: cfg.sections.map((s) => s.id),
    clusters: ranked.map((c) => ({
      id: c.id,
      headline: c.headline,
      explainer: c.explainer,
      section: c.section,
      alsoIn: c.alsoIn,
      slug: c.slug,
      score: Math.round(score(c, cfg.ranking, now) * 100) / 100,
      breakdown: scoreBreakdown(c, cfg.ranking, now),
      createdAt: c.createdAt,
      editHistory: c.editHistory ?? [],
      topRank: topIds.indexOf(c.id) >= 0 ? topIds.indexOf(c.id) + 1 : null,
      sectionRank: sectionRanks.get(c.id) ?? null,
      farcasterUrl:
        c.posted?.farcasterHash && siteIdentity().social?.farcasterHandle
          ? `https://farcaster.xyz/${siteIdentity().social!.farcasterHandle}/${c.posted.farcasterHash.slice(0, 10)}`
          : null,
      linkList: c.links.map((l) => ({ url: l.url, sourceName: l.sourceName, title: l.title })),
      leadUrl: c.leadUrl ?? null,
      links: c.links.length,
      pinned: Boolean(c.pinned),
      needsReview: Boolean(c.needsReview),
      postedX: Boolean(c.posted?.x),
      postedFarcaster: Boolean(c.posted?.farcaster),
    })),
    xMonthly: buildChrome(state, cfg).xMonthly,
    submissions: (state.submissions ?? [])
      .filter((s) => s.status === "pending")
      .map((s) => {
        const story = s.storySlug ? Object.values(state.clusters).find((c) => c.slug === s.storySlug) : undefined;
        return {
          id: s.id,
          url: s.url,
          ...(s.note ? { note: s.note } : {}),
          ...(s.email ? { email: s.email } : {}),
          ...(story ? { storyHeadline: story.headline, storySlug: story.slug } : {}),
          newSource: s.newSource,
          at: s.at,
        };
      }),
  };

  return (
    <main className="wrap page single admin">
      <StoriesClient chrome={buildChrome(state, cfg)} data={data} initialFilter={filter ?? ""} />
    </main>
  );
}
