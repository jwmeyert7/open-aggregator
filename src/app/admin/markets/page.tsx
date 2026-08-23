import { MarketsClient, type MarketsData } from "./MarketsClient";
import { buildChrome, NotLoggedIn } from "../server";
import { isAdmin } from "@/lib/auth";
import { loadSiteConfig } from "@/lib/config";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin · Markets", robots: { index: false } };

export default async function AdminMarketsPage() {
  if (!(await isAdmin())) return <NotLoggedIn />;

  const state = await loadState();
  const cfg = loadSiteConfig();

  const o = state.marketOverrides ?? { custom: [], disabled: [] };
  const customSlugs = new Set(o.custom.map((m) => m.slug));
  const data: MarketsData = {
    sections: cfg.sections.map((s) => s.id),
    markets: [...(cfg.polymarket?.markets ?? []), ...o.custom].map((m) => {
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
    }),
    marketCfg: cfg.polymarket
      ? {
          threshold: cfg.polymarket.movePointsThreshold,
          cooldownHours: cfg.polymarket.cooldownHours,
          minLiquidity: cfg.polymarket.minLiquidity,
        }
      : null,
  };

  return (
    <main className="wrap page single admin">
      <MarketsClient chrome={buildChrome(state, cfg)} data={data} />
    </main>
  );
}
