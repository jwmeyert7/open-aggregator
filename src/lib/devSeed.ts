import { runPipeline } from "./pipeline";
import type { SiteState } from "./types";

/**
 * Seed on empty, dev only: the first page load against a state with no
 * stories and no history kicks off one background pipeline run, so a fresh
 * clone shows real content on the next refresh with zero instructions.
 * Never fires in production, where the cron owns the pipeline, so a
 * misconfigured deploy cannot silently spend LLM money.
 */
let started = false;

export function maybeDevSeed(state: SiteState): void {
  if (process.env.NODE_ENV !== "development" || started) return;
  const empty =
    Object.keys(state.clusters).length === 0 && state.items.length === 0 && (state.runLog ?? []).length === 0;
  if (!empty) return;
  // latch only when firing, so an emptied .data reseeds without a restart
  started = true;
  console.log("[dev seed] Empty state, running the pipeline once in the background. Refresh in about half a minute.");
  void runPipeline()
    .then((report) => console.log(`[dev seed] Run complete: ${report.newItems} new item(s).`))
    .catch((err) => console.error("[dev seed] Run failed:", err instanceof Error ? err.message : err));
}
