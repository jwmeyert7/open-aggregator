import { EditionsClient, type EditionsData } from "./EditionsClient";
import { buildChrome, NotLoggedIn } from "../server";
import { isAdmin } from "@/lib/auth";
import { loadSiteConfig } from "@/lib/config";
import { leadLink } from "@/lib/rank";
import { loadDailyDigest, loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin · Editions", robots: { index: false } };

/**
 * Frozen daily editions and the correction flow. A correction never edits
 * the sealed file in place: it produces a new version with its own seal,
 * linked to the one it replaces, and the reason goes on the record.
 */
export default async function AdminEditionsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  if (!(await isAdmin())) return <NotLoggedIn />;
  const state = await loadState();
  const cfg = loadSiteConfig();
  const today = new Date().toISOString().slice(0, 10);
  const dates = (state.dailyDigestDates ?? []).filter((d) => d !== today).slice(0, 30);

  const list = await Promise.all(
    dates.map(async (d) => {
      const dg = await loadDailyDigest(d);
      return {
        date: d,
        stories: dg?.clusters.length ?? 0,
        version: dg?.version ?? 1,
        attested: Boolean(dg?.attestationUid),
        corrections: dg?.corrections?.length ?? 0,
      };
    })
  );

  let editing: EditionsData["editing"] = null;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const dg = await loadDailyDigest(date);
    if (dg && !dg.inProgress && dg.contentHash) {
      editing = {
        date,
        version: dg.version ?? 1,
        contentHash: dg.contentHash,
        attestationUid: dg.attestationUid ?? null,
        corrections: dg.corrections ?? [],
        stories: dg.clusters.map((c) => {
          const live = state.clusters[c.id];
          return {
            id: c.id,
            headline: c.headline,
            explainer: c.explainer ?? "",
            section: c.section,
            source: leadLink(c)?.sourceName ?? "",
            // the live story may have been fixed already; offer its current text
            live:
              live && (live.headline !== c.headline || (live.explainer ?? "") !== (c.explainer ?? "") || live.section !== c.section)
                ? { headline: live.headline, explainer: live.explainer ?? "", section: live.section, killed: Boolean(live.killed) }
                : null,
          };
        }),
      };
    }
  }

  const data: EditionsData = { sections: cfg.sections.map((s) => s.id), list, editing };
  return (
    <main className="wrap page single admin">
      <EditionsClient chrome={buildChrome(state, cfg)} data={data} />
    </main>
  );
}
