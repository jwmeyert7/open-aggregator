import { SourcesClient, type SourcesData } from "./SourcesClient";
import { buildChrome, NotLoggedIn, undecidedCandidates } from "../server";
import { isAdmin } from "@/lib/auth";
import { loadFeeds, loadSiteConfig } from "@/lib/config";
import { isMediaFeed } from "@/lib/feeds";
import { loadState } from "@/lib/state";
import { utcDay } from "@/lib/util";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin · Sources", robots: { index: false } };

export default async function AdminSourcesPage() {
  if (!(await isAdmin())) return <NotLoggedIn />;

  const state = await loadState();
  const cfg = loadSiteConfig();

  const o = state.feedOverrides ?? { custom: [], disabled: [] };
  const customIds = new Set(o.custom.map((f) => f.id));
  // the same 30 day window the public Sources page counts
  const cutoff = utcDay(new Date(Date.now() - 30 * 24 * 60 * 60000).toISOString());
  const episodesByShow = new Map<string, number>();
  for (const m of state.mediaItems ?? []) {
    if (m.hidden || m.publishedAt.slice(0, 10) < cutoff) continue;
    episodesByShow.set(m.sourceName, (episodesByShow.get(m.sourceName) ?? 0) + 1);
  }
  const data: SourcesData = {
    sections: cfg.sections.map((s) => s.id),
    sources: [...loadFeeds(), ...o.custom]
      .map((f) => ({ ...f, ...(o.edits?.[f.id] ?? {}) }))
      .map((f) => {
        const h = state.feedHealth[f.id];
        const media = isMediaFeed(f);
        const count = media
          ? (episodesByShow.get(f.name) ?? 0)
          : Object.entries(state.sourceStats?.[f.id] ?? {}).reduce((sum, [day, s]) => (day >= cutoff ? sum + s.accepted : sum), 0);
        return {
          id: f.id,
          name: f.name,
          url: f.url,
          tier: f.tier,
          weight: f.weight,
          category: f.category ?? "other",
          type: f.type,
          sectionHint: f.sectionHint ?? "",
          thumbStyle: f.thumbStyle ?? "episode",
          custom: customIds.has(f.id),
          disabled: o.disabled.includes(f.id),
          health: h?.consecutiveErrors
            ? `${h.consecutiveErrors} consecutive errors (${h.lastError ?? "unknown"})`
            : h?.lastSuccessAt
              ? "ok"
              : "not yet polled",
          healthKind: h?.consecutiveErrors ? ("bad" as const) : h?.lastSuccessAt ? ("ok" as const) : ("new" as const),
          count,
        };
      }),
    sourceCandidates: undecidedCandidates(state),
  };

  return (
    <main className="wrap page single admin">
      <SourcesClient chrome={buildChrome(state, cfg)} data={data} />
    </main>
  );
}
