import { loadEngineConfig, loadFeeds } from "./config";
import { enrichNewItems, fetchAllFeeds, updateFeedHealth } from "./feeds";
import { classifyAndCluster, heuristicFallback, llmAvailable, type EditorOutput } from "./llm";
import { liveClusters, topStories } from "./rank";
import { loadState, saveState } from "./state";
import type { CandidateItem, Cluster, EngineConfig, EngineState } from "./types";
import { hoursAgo, newId, normalizeUrl, sha256, slugify, stripEmDashes, truncate } from "./util";

export interface RunReport {
  fetchedFeeds: number;
  feedErrors: Array<{ feedId: string; error: string }>;
  newItems: number;
  usedLlm: boolean;
  rejected: number;
  clustersCreated: number;
  clustersUpdated: number;
  notes: string[];
}

/**
 * Clusters worth showing the LLM as clustering context: recently active only,
 * bounded in count, so the per-run token cost stays flat as the archive grows.
 */
function digestClusters(state: EngineState, cfg: EngineConfig["ingest"]): Cluster[] {
  return liveClusters(state)
    .filter((c) => hoursAgo(c.updatedAt) <= cfg.seenHashRetentionDays * 24)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 120);
}

function dedupeKeyUrl(url: string): string {
  return sha256(`url:${normalizeUrl(url)}`);
}

function dedupeKeyContent(title: string, sourceId: string): string {
  return sha256(`content:${sourceId}:${title.toLowerCase().trim()}`);
}

/** New = URL unseen AND content hash unseen. Also dedupes within the batch itself. */
function selectNewItems(state: EngineState, candidates: CandidateItem[]): Array<CandidateItem & { id: string }> {
  const out: Array<CandidateItem & { id: string }> = [];
  const batchSeen = new Set<string>();
  for (const c of candidates) {
    const kUrl = dedupeKeyUrl(c.url);
    const kContent = dedupeKeyContent(c.title, c.sourceId);
    if (state.seen[kUrl] || state.seen[kContent] || batchSeen.has(kUrl) || batchSeen.has(kContent)) continue;
    batchSeen.add(kUrl);
    batchSeen.add(kContent);
    out.push({ ...c, id: kUrl.slice(0, 12) });
  }
  return out;
}

function markSeen(state: EngineState, item: CandidateItem): void {
  const now = new Date().toISOString();
  state.seen[dedupeKeyUrl(item.url)] = now;
  state.seen[dedupeKeyContent(item.title, item.sourceId)] = now;
}

/** The page renders the explainer directly, so strip a stray "What this means" lead-in. */
function cleanExplainer(raw: string): string {
  return truncate(stripEmDashes(raw.replace(/^\s*what (?:this|it) means[:,]?\s*/i, "").trim()), 280);
}

/**
 * Apply the editor's (LLM or fallback) decisions to state: create and update
 * clusters, then attach passing items to their clusters as coverage links and
 * as raw items. Sections outside the configured set fall back to the item's
 * hint or the first section, and importance is clamped to 1 to 5.
 */
function applyEditorOutput(
  state: EngineState,
  newItems: Array<CandidateItem & { id: string }>,
  out: EditorOutput,
  validSections: Set<string>,
  defaultSection: string
): { rejected: number; clustersCreated: number; clustersUpdated: number; touched: Set<string> } {
  const now = new Date().toISOString();
  const byId = new Map(newItems.map((i) => [i.id, i]));
  const refToCluster = new Map<string, Cluster>();
  let clustersCreated = 0;
  let clustersUpdated = 0;

  const cleanSection = (s: string, fallback: string): string => (validSections.has(s) ? s : fallback);
  const clampImportance = (n: number): number => Math.max(1, Math.min(5, Math.round(n)));

  for (const c of out.clusters) {
    if (c.ref.startsWith("new:")) {
      const id = newId();
      const cluster: Cluster = {
        id,
        slug: slugify(c.headline, id),
        headline: stripEmDashes(truncate(c.headline, 140)),
        explainer: cleanExplainer(c.explainer),
        section: cleanSection(c.section, defaultSection),
        links: [],
        importance: clampImportance(c.importance),
        keywords: c.keywords ?? [],
        createdAt: now,
        updatedAt: now,
      };
      state.clusters[id] = cluster;
      refToCluster.set(c.ref, cluster);
      clustersCreated += 1;
    } else {
      const existing = state.clusters[c.ref];
      if (!existing) continue; // referenced a cluster we do not have, ignore
      existing.headline = stripEmDashes(truncate(c.headline, 140));
      existing.explainer = cleanExplainer(c.explainer);
      existing.section = cleanSection(c.section, existing.section);
      existing.importance = clampImportance(c.importance);
      existing.keywords = c.keywords ?? existing.keywords;
      existing.updatedAt = now;
      refToCluster.set(c.ref, existing);
      clustersUpdated += 1;
    }
  }

  let rejected = 0;
  const touched = new Set<string>();
  for (const decision of out.items) {
    const item = byId.get(decision.id);
    if (!item) continue;
    markSeen(state, item);
    if (!decision.pass || !decision.clusterRef) {
      rejected += 1;
      continue;
    }
    const cluster = refToCluster.get(decision.clusterRef) ?? state.clusters[decision.clusterRef];
    if (!cluster) {
      rejected += 1;
      continue;
    }
    state.items.unshift({
      id: item.id,
      url: item.url,
      title: item.title,
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      tier: item.tier,
      publishedAt: item.publishedAt,
      ingestedAt: now,
      excerpt: item.excerpt,
      clusterId: cluster.id,
    });
    if (!cluster.links.some((l) => normalizeUrl(l.url) === normalizeUrl(item.url))) {
      cluster.links.push({
        url: item.url,
        title: item.title,
        sourceId: item.sourceId,
        sourceName: item.sourceName,
        tier: item.tier,
        weight: item.weight,
        publishedAt: item.publishedAt,
        addedAt: now,
      });
    }
    cluster.updatedAt = now;
    touched.add(cluster.id);
  }

  // A new cluster no item ended up joining has no links, so nothing to render
  // or rank. Drop it.
  for (const c of out.clusters) {
    if (!c.ref.startsWith("new:")) continue;
    const created = refToCluster.get(c.ref);
    if (created && state.clusters[created.id] && created.links.length === 0) {
      delete state.clusters[created.id];
      touched.delete(created.id);
      clustersCreated -= 1;
    }
  }

  return { rejected, clustersCreated, clustersUpdated, touched };
}

/** Drop expired seen hashes, stale idle clusters, and cap the raw item list. */
function prune(state: EngineState, cfg: EngineConfig["ingest"]): void {
  const retentionHours = cfg.seenHashRetentionDays * 24;
  state.items = state.items.filter((i) => hoursAgo(i.ingestedAt) <= retentionHours).slice(0, cfg.maxItems);
  for (const [hash, firstSeen] of Object.entries(state.seen)) {
    if (hoursAgo(firstSeen) > retentionHours) delete state.seen[hash];
  }
  for (const [id, c] of Object.entries(state.clusters)) {
    if (c.links.length === 0 || hoursAgo(c.updatedAt) > retentionHours) delete state.clusters[id];
  }
}

/**
 * The whole engine: fetch, dedupe, edit, merge, prune, save. Idempotent: a
 * re-run of the same inputs is a no-op (dedupe by hash), and state is written
 * only after a fully successful merge.
 */
export async function runPipeline(): Promise<RunReport> {
  const cfg = loadEngineConfig();
  const feeds = loadFeeds();
  const state = loadState();
  const validSections = new Set(cfg.sections.map((s) => s.id));
  const defaultSection = cfg.sections[0]?.id ?? "general";

  const report: RunReport = {
    fetchedFeeds: feeds.length,
    feedErrors: [],
    newItems: 0,
    usedLlm: false,
    rejected: 0,
    clustersCreated: 0,
    clustersUpdated: 0,
    notes: [],
  };

  const results = await fetchAllFeeds(feeds, cfg.ingest);
  report.feedErrors = results.filter((r) => r.error).map((r) => ({ feedId: r.feed.id, error: r.error! }));

  const candidates = results.flatMap((r) => r.items);
  let newItems = selectNewItems(state, candidates);

  // Listing feeds are scraped pages with no publish dates: their first crawl
  // only baselines what already exists (marked seen, not ingested), so only
  // posts appearing on later crawls become news, timestamped by discovery.
  const firstCrawlListings = new Set(
    feeds.filter((f) => f.type === "listing" && !state.feedHealth[f.id]).map((f) => f.id)
  );
  if (firstCrawlListings.size > 0) {
    const baselined = newItems.filter((i) => firstCrawlListings.has(i.sourceId));
    for (const i of baselined) markSeen(state, i);
    if (baselined.length > 0) report.notes.push(`Baselined ${baselined.length} existing posts from new listing feeds.`);
    newItems = newItems.filter((i) => !firstCrawlListings.has(i.sourceId));
  }

  report.newItems = newItems.length;
  updateFeedHealth(state, results, new Set(newItems.map((i) => i.sourceId)));

  if (newItems.length > 0) {
    await enrichNewItems(newItems, feeds, cfg.ingest.feedTimeoutMs);
    let out: EditorOutput;
    if (llmAvailable()) {
      out = await classifyAndCluster(newItems, digestClusters(state, cfg.ingest), cfg.sections.map((s) => s.id));
      report.usedLlm = true;
    } else {
      report.notes.push(
        "No LLM key set (ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY). Using heuristic fallback: tier-1 items only, no gating."
      );
      out = heuristicFallback(newItems, defaultSection);
    }
    const applied = applyEditorOutput(state, newItems, out, validSections, defaultSection);
    report.rejected = applied.rejected;
    report.clustersCreated = applied.clustersCreated;
    report.clustersUpdated = applied.clustersUpdated;
  }

  prune(state, cfg.ingest);
  saveState(state);

  // A small readout so the CLI can report what the page now leads with.
  report.notes.push(`Top stories now: ${topStories(state, cfg.ranking).length}.`);

  return report;
}
