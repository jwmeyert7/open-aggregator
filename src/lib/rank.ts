import { loadFeeds } from "./config";
import type { Cluster, RiverItem, SiteConfig, SiteState, SectionId, WeekendSchedule } from "./types";
import { hoursAgo } from "./util";

/**
 * Open forums are user-generated content: a single uncorroborated forum post
 * cannot carry high importance on its own, however severe it sounds. The cap
 * lifts the moment any second source joins the cluster. Reads the static
 * feeds.json categories; admin category overrides don't apply here.
 */
const FORUM_IMPORTANCE_CAP = 2;
let forumIdsCache: Set<string> | null = null;
function forumSourceIds(): Set<string> {
  if (!forumIdsCache) {
    forumIdsCache = new Set(
      loadFeeds()
        .filter((f) => f.category === "forum")
        .map((f) => f.id)
    );
  }
  return forumIdsCache;
}

/**
 * Scores are computed at read time (never stored), so time decay works
 * without the cron having to rewrite state on runs that found nothing new.
 */
export interface ScoreBreakdown {
  uniqueSources: number;
  sourceWeight: number;
  /** Source weight after each link decays on its own clock (what actually scores). */
  decayedSourceWeight: number;
  velocityLinks: number;
  velocityBoostPerLink: number;
  importance: number;
  importanceCapped: boolean;
  importanceFactor: number;
  /** 1 unless the cluster's only source is an open forum (provisional haircut). */
  forumFactor: number;
  centrality: number;
  centralityFactor: number;
  freshestAgeHours: number;
  decayHalfLifeHours: number;
  decay: number;
  total: number;
}

export function scoreBreakdown(cluster: Cluster, cfg: SiteConfig["ranking"], now: Date = new Date()): ScoreBreakdown {
  // Each link's weight decays from its OWN publish time. A late follow-up
  // contributes its own fresh weight but cannot resurrect the old links'
  // weight, so a days-old story with one new link resurfaces modestly
  // instead of leaping back to the top as if brand new.
  const bySource = new Map<string, number>();
  const bySourceDecayed = new Map<string, number>();
  for (const l of cluster.links) {
    bySource.set(l.sourceId, Math.max(bySource.get(l.sourceId) ?? 0, l.weight));
    const linkDecay = Math.pow(0.5, Math.max(0, hoursAgo(l.publishedAt, now)) / cfg.decayHalfLifeHours);
    bySourceDecayed.set(l.sourceId, Math.max(bySourceDecayed.get(l.sourceId) ?? 0, l.weight * linkDecay));
  }
  const sourceWeight = [...bySource.values()].reduce((a, b) => a + b, 0);
  const decayedSourceWeight = [...bySourceDecayed.values()].reduce((a, b) => a + b, 0);
  const velocityLinks = cluster.links.filter((l) => hoursAgo(l.addedAt, now) <= cfg.velocityWindowHours).length;
  const soleSource = bySource.size === 1 ? [...bySource.keys()][0] : undefined;
  const forumSolo = soleSource !== undefined && forumSourceIds().has(soleSource);
  const importanceCapped = forumSolo && cluster.importance > FORUM_IMPORTANCE_CAP;
  const importance = importanceCapped ? FORUM_IMPORTANCE_CAP : cluster.importance;
  const importanceFactor = 1 + (importance - 3) * cfg.importanceFactorPerPoint;
  // a lone forum post rides in provisionally: fresh stories face decayed
  // competition, so without this haircut any new forum post opens near #1
  const forumFactor = forumSolo ? (cfg.soloForumFactor ?? 0.6) : 1;
  // an omitted rating must not score better than a poor one
  const centrality = cluster.centrality ?? 2;
  const centralityFactor = 1 + (centrality - 3) * (cfg.centralityFactorPerPoint ?? 0);
  const freshest = Math.max(
    0,
    cluster.links.reduce((min, l) => Math.min(min, hoursAgo(l.publishedAt, now)), hoursAgo(cluster.createdAt, now))
  );
  const decay = Math.pow(0.5, freshest / cfg.decayHalfLifeHours);
  return {
    uniqueSources: bySource.size,
    sourceWeight,
    decayedSourceWeight,
    velocityLinks,
    velocityBoostPerLink: cfg.velocityBoostPerLink,
    importance: cluster.importance,
    importanceCapped,
    importanceFactor,
    forumFactor,
    centrality,
    centralityFactor,
    freshestAgeHours: freshest,
    decayHalfLifeHours: cfg.decayHalfLifeHours,
    decay,
    total:
      (decayedSourceWeight + velocityLinks * cfg.velocityBoostPerLink) *
      importanceFactor *
      centralityFactor *
      forumFactor,
  };
}

export function score(cluster: Cluster, cfg: SiteConfig["ranking"], now: Date = new Date()): number {
  return scoreBreakdown(cluster, cfg, now).total;
}

/**
 * How big the story was, with age factored out entirely. Used for the week in
 * review and the daily digest, where "what mattered" beats "what is newest".
 */
export function magnitude(cluster: Cluster, cfg: SiteConfig["ranking"]): number {
  const b = scoreBreakdown(cluster, cfg);
  return b.sourceWeight * b.importanceFactor * b.centralityFactor * b.forumFactor;
}

/**
 * Ranking config with decay stretched to match how much news is actually
 * arriving. Inflow drops roughly eightfold at weekends, and against a fixed
 * 16 hour half life that leaves Friday's real stories faded to nothing while
 * nothing new has replaced them. Stretching the half life when the stream goes
 * quiet keeps the genuine stories legible without inventing any.
 *
 * Display only. Bots keep the unstretched config so a quiet spell cannot make
 * them post stale news.
 */
export function adaptiveRanking(
  state: SiteState,
  cfg: SiteConfig["ranking"],
  now: Date = new Date()
): SiteConfig["ranking"] {
  const baseline = cfg.quietInflowPerDay ?? 0;
  const maxStretch = cfg.maxDecayStretch ?? 1;
  if (baseline <= 0 || maxStretch <= 1) return cfg;
  const recent = state.items.filter((i) => hoursAgo(i.ingestedAt, now) <= 24).length;
  const stretch = Math.min(maxStretch, Math.max(1, baseline / Math.max(recent, 1)));
  return stretch > 1 ? { ...cfg, decayHalfLifeHours: cfg.decayHalfLifeHours * stretch } : cfg;
}

/** The built-in weekend window: Saturday 00:00 UTC through Monday morning. */
export function defaultWeekendSchedule(cfg: SiteConfig["ranking"]): WeekendSchedule {
  return { startDow: 6, startHour: 0, endDow: 1, endHour: cfg.weekendUntilMondayHourUtc ?? 0 };
}

/**
 * True while the front page should lead with the week rather than the day.
 * Defaults to Saturday 00:00 UTC through Monday morning (inflow has not
 * recovered by the time Monday starts in UTC); an admin-edited schedule from
 * state overrides the default.
 */
export function weekendMode(cfg: SiteConfig["ranking"], now: Date = new Date(), schedule?: WeekendSchedule): boolean {
  const s = schedule ?? defaultWeekendSchedule(cfg);
  const h = now.getUTCDay() * 24 + now.getUTCHours() + now.getUTCMinutes() / 60;
  const start = s.startDow * 24 + s.startHour;
  const end = s.endDow * 24 + s.endHour;
  // a window that wraps the week boundary (Saturday → Monday) inverts the test
  return start <= end ? h >= start && h < end : h >= start || h < end;
}

/**
 * The week's biggest stories by magnitude, for the weekend front page. Skips
 * anything already listed in Top Stories so the page never repeats itself.
 */
export function weekInReview(
  state: SiteState,
  cfg: SiteConfig["ranking"],
  excludeIds: Set<string>,
  now: Date = new Date()
): Cluster[] {
  const broke = (c: Cluster) =>
    c.links.reduce((min, l) => (l.publishedAt < min ? l.publishedAt : min), c.links[0]?.publishedAt ?? c.createdAt);
  const eligible = liveClusters(state).filter(
    (c) => !excludeIds.has(c.id) && hoursAgo(broke(c), now) <= 7 * 24
  );
  // What mattered this week is a question about importance first. Magnitude
  // alone lets a routine client release outrank a corroborated exploit, because
  // primary sources carry heavy weight, so importance leads and magnitude only
  // breaks ties. Anything the editor called routine is not a story of the week.
  const eff = (c: Cluster) => {
    const b = scoreBreakdown(c, cfg, now);
    return b.importanceCapped ? FORUM_IMPORTANCE_CAP : c.importance;
  };
  const ranked = [...eligible].sort((a, b) => eff(b) - eff(a) || magnitude(b, cfg) - magnitude(a, cfg));
  const limit = cfg.maxWeekInReview ?? 5;
  const notable = ranked.filter((c) => eff(c) >= 2);
  return (notable.length >= 3 ? notable : ranked).slice(0, limit);
}

export function liveClusters(state: SiteState): Cluster[] {
  return Object.values(state.clusters).filter((c) => !c.killed);
}

export function rankClusters(clusters: Cluster[], cfg: SiteConfig["ranking"], now: Date = new Date()): Cluster[] {
  return [...clusters].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return score(b, cfg, now) - score(a, cfg, now);
  });
}

/**
 * Top stories: biggest clusters regardless of section. Never pad with weak
 * stories: eligibility needs corroboration (2+ sources) or real importance,
 * so quiet periods shrink the list instead of crowning routine posts.
 * Everything still appears in its section page and the Newest rail.
 */
export function topStories(state: SiteState, cfg: SiteConfig["ranking"], now: Date = new Date()): Cluster[] {
  const ranked = rankClusters(liveClusters(state), cfg, now);
  return ranked
    .filter((c) => {
      if (c.pinned) return true;
      const b = scoreBreakdown(c, cfg, now);
      const effImportance = b.importanceCapped ? FORUM_IMPORTANCE_CAP : c.importance;
      return (b.uniqueSources >= 2 || effImportance >= 3) && b.total >= cfg.minTopScore;
    })
    .slice(0, cfg.maxTopStories);
}

export function sectionStories(state: SiteState, section: SectionId, cfg: SiteConfig["ranking"], now: Date = new Date()): Cluster[] {
  const ranked = rankClusters(liveClusters(state).filter((c) => c.section === section), cfg, now);
  return ranked.slice(0, cfg.maxSectionStories);
}

/**
 * Display title for a stream/newest item: single-article stories borrow their
 * cluster's edited headline (it's a better label for the same article);
 * multi-article clusters keep each item's own title.
 */
export function itemDisplayTitle(state: SiteState, item: RiverItem): string {
  const c = item.clusterId ? state.clusters[item.clusterId] : undefined;
  return c && !c.killed && c.links.length === 1 && c.headline ? c.headline : item.title;
}

/** River items newest-first by publish time (ingest order breaks on backfills). */
export function byPublished(items: RiverItem[]): RiverItem[] {
  return [...items].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

/** Lead link for a cluster: primary sources (weight) first, earliest coverage breaks ties. */
export function leadLink(cluster: Cluster) {
  return [...cluster.links].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.weight !== b.weight) return b.weight - a.weight;
    return new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime();
  })[0];
}
