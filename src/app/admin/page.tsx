import { AdminClient, type AdminData } from "./AdminClient";
import { adminLayoutPreview, isAdmin } from "@/lib/auth";
import { effectiveFeeds, loadFeeds, loadSiteConfig } from "@/lib/config";
import { unhealthyFeeds } from "@/lib/feeds";
import { knownSourceHosts } from "@/lib/pipeline";
import { defaultWeekendSchedule, liveClusters, rankClusters, score, scoreBreakdown, topStories, weekendMode } from "@/lib/rank";
import { xMonthlyCount } from "@/lib/social/x";
import { loadDailyDigest, loadState } from "@/lib/state";
import { siteIdentity } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin", robots: { index: false } };

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter } = await searchParams;
  if (!(await isAdmin())) {
    return (
      <main className="wrap page single admin">
        <AdminClient authed={false} data={null} />
      </main>
    );
  }

  const state = await loadState();
  const cfg = loadSiteConfig();
  const now = new Date();
  const ranked = rankClusters(liveClusters(state), cfg.ranking, now).slice(0, 40);
  const topIds = topStories(state, cfg.ranking, now).map((c) => c.id);
  const sectionRanks = new Map<string, number>();
  for (const s of cfg.sections) {
    rankClusters(liveClusters(state).filter((c) => c.section === s.id), cfg.ranking, now).forEach((c, i) =>
      sectionRanks.set(c.id, i + 1)
    );
  }

  const data: AdminData = {
    sections: cfg.sections.map((s) => s.id),
    clusters: ranked.map((c) => ({
      id: c.id,
      headline: c.headline,
      explainer: c.explainer,
      section: c.section,
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
      links: c.links.length,
      pinned: Boolean(c.pinned),
      needsReview: Boolean(c.needsReview),
      postedX: Boolean(c.posted?.x),
      postedFarcaster: Boolean(c.posted?.farcaster),
    })),
    xMonthly: { used: xMonthlyCount(state), cap: cfg.bots.x.maxPerMonth },
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
    unhealthyFeeds: unhealthyFeeds(state, effectiveFeeds(state), cfg.ingest).map((u) => ({
      name: u.feed.name,
      reason: u.reason,
    })),
    sources: (() => {
      const o = state.feedOverrides ?? { custom: [], disabled: [] };
      const customIds = new Set(o.custom.map((f) => f.id));
      return [...loadFeeds(), ...o.custom]
        .map((f) => ({ ...f, ...(o.edits?.[f.id] ?? {}) }))
        .map((f) => {
          const h = state.feedHealth[f.id];
          return {
            id: f.id,
            name: f.name,
            url: f.url,
            tier: f.tier,
            weight: f.weight,
            category: f.category ?? "other",
            custom: customIds.has(f.id),
            disabled: o.disabled.includes(f.id),
            health: h?.consecutiveErrors
              ? `${h.consecutiveErrors} consecutive errors (${h.lastError ?? "unknown"})`
              : h?.lastSuccessAt
                ? "ok"
                : "not yet polled",
          };
        });
    })(),
    markets: (() => {
      const o = state.marketOverrides ?? { custom: [], disabled: [] };
      const customSlugs = new Set(o.custom.map((m) => m.slug));
      return [...(cfg.polymarket?.markets ?? []), ...o.custom].map((m) => {
        const base = state.marketBaselines?.[m.slug];
        const move = state.marketMoves?.[m.slug];
        return {
          slug: m.slug,
          label: m.label,
          section: m.section ?? "world",
          custom: customSlugs.has(m.slug),
          disabled: o.disabled.includes(m.slug),
          // last observed implied probability (rolling baseline, may lag up to a day)
          prob: base ? Math.round(base.prob * 100) : null,
          // real event-page URL once the API has resolved the market; the
          // guessed form is a placeholder that may not land anywhere
          url: base?.url ?? `https://polymarket.com/market/${m.slug}`,
          resolved: Boolean(base?.url),
          lastSwingAt: move?.at ?? null,
        };
      });
    })(),
    marketCfg: cfg.polymarket
      ? {
          threshold: cfg.polymarket.movePointsThreshold,
          cooldownHours: cfg.polymarket.cooldownHours,
          minLiquidity: cfg.polymarket.minLiquidity,
        }
      : null,
    // domains Farcaster keeps linking that no source of ours covers, busiest
    // first; a candidate whose domain has since become a source is a stale
    // record awaiting expiry, not a decision, so it is hidden here
    sourceCandidates: (() => {
      const covered = knownSourceHosts(state);
      return Object.values(state.sourceCandidates ?? {})
        .filter((c) => !c.dismissed && !covered.has(c.host))
        .sort((a, b) => b.casts - a.casts || b.engagement - a.engagement)
        .slice(0, 30);
    })(),
    jobs: state.jobs,
    events: state.events,
    podcasts: state.podcasts ?? [],
    announcement: state.announcement ?? null,
    sponsoredPosts: state.sponsoredPosts ?? [],
    sponsorPageEnabled: Boolean(state.sponsorPageEnabled),
    layout: {
      preview: await adminLayoutPreview(),
      scheduled: weekendMode(cfg.ranking, now, state.weekendSchedule) ? "weekend" : "weekday",
      schedule: state.weekendSchedule ?? defaultWeekendSchedule(cfg.ranking),
      custom: Boolean(state.weekendSchedule),
    },
    subscribers: {
      daily: (state.digestSubscribers ?? []).filter((s) => s.daily).length,
      weekly: (state.digestSubscribers ?? []).filter((s) => s.weekly).length,
    },
    emailSubscribers: (state.digestSubscribers ?? []).map((s) => ({
      email: s.email,
      daily: s.daily,
      weekly: s.weekly,
      confirmed: s.confirmed !== false,
      addedAt: s.addedAt,
    })),
    riverCount: state.items.length,
    updatedAt: state.updatedAt,
    runs: state.runLog ?? [],
    digests: await Promise.all(
      (state.dailyDigestDates ?? []).slice(0, 7).map(async (d) => {
        const dg = await loadDailyDigest(d);
        return {
          date: d,
          stories: dg?.clusters.length ?? 0,
          cast: Boolean(dg?.castHash),
          tweetId: dg?.tweetId ?? null,
        };
      })
    ),
  };

  return (
    <main className="wrap page single admin">
      <AdminClient authed data={data} initialFilter={filter ?? ""} />
    </main>
  );
}
