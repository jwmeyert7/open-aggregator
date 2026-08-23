import { SourcesClient, type SourcesData } from "./SourcesClient";
import { buildChrome, NotLoggedIn, undecidedCandidates } from "../server";
import { isAdmin } from "@/lib/auth";
import { loadFeeds, loadSiteConfig } from "@/lib/config";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin · Sources", robots: { index: false } };

export default async function AdminSourcesPage() {
  if (!(await isAdmin())) return <NotLoggedIn />;

  const state = await loadState();
  const cfg = loadSiteConfig();

  const o = state.feedOverrides ?? { custom: [], disabled: [] };
  const customIds = new Set(o.custom.map((f) => f.id));
  const data: SourcesData = {
    sections: cfg.sections.map((s) => s.id),
    sources: [...loadFeeds(), ...o.custom]
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
      }),
    sourceCandidates: undecidedCandidates(state),
  };

  return (
    <main className="wrap page single admin">
      <SourcesClient chrome={buildChrome(state, cfg)} data={data} />
    </main>
  );
}
