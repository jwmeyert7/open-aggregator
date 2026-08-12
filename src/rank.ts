import type { Cluster, EngineConfig, EngineState, Section } from "./types";
import { hoursAgo } from "./util";

/**
 * Scores are computed at read time and never stored, so time decay works
 * without a run having to rewrite state when it found nothing new.
 *
 * score = decayed source weight, plus a velocity boost for recent links,
 * scaled by an importance factor.
 *
 * Each link's weight decays from its OWN publish time. A late follow-up
 * contributes its own fresh weight but cannot resurrect the old links' weight,
 * so a days-old story with one new link resurfaces modestly instead of leaping
 * back to the top as if brand new. Only the strongest link per source counts,
 * so a chatty source cannot inflate a story by publishing it many times.
 */
export function score(cluster: Cluster, cfg: EngineConfig["ranking"], now: Date = new Date()): number {
  const bySourceDecayed = new Map<string, number>();
  for (const l of cluster.links) {
    const linkDecay = Math.pow(0.5, Math.max(0, hoursAgo(l.publishedAt, now)) / cfg.decayHalfLifeHours);
    bySourceDecayed.set(l.sourceId, Math.max(bySourceDecayed.get(l.sourceId) ?? 0, l.weight * linkDecay));
  }
  const decayedSourceWeight = [...bySourceDecayed.values()].reduce((a, b) => a + b, 0);
  const velocityLinks = cluster.links.filter((l) => hoursAgo(l.addedAt, now) <= cfg.velocityWindowHours).length;
  const importanceFactor = 1 + (cluster.importance - 3) * cfg.importanceFactorPerPoint;
  return (decayedSourceWeight + velocityLinks * cfg.velocityBoostPerLink) * importanceFactor;
}

/** Distinct sources backing a cluster: corroboration, used as a Top Stories bar. */
function uniqueSources(cluster: Cluster): number {
  return new Set(cluster.links.map((l) => l.sourceId)).size;
}

/** Clusters that can actually render: a cluster with no links is editorial debris. */
export function liveClusters(state: EngineState): Cluster[] {
  return Object.values(state.clusters).filter((c) => c.links.length > 0);
}

export function rankClusters(clusters: Cluster[], cfg: EngineConfig["ranking"], now: Date = new Date()): Cluster[] {
  return [...clusters].sort((a, b) => score(b, cfg, now) - score(a, cfg, now));
}

/**
 * Top stories: the biggest clusters regardless of section. Eligibility needs
 * corroboration (2 or more sources) or real importance, so quiet periods shrink
 * the list instead of crowning routine posts. Everything still appears on its
 * section list.
 */
export function topStories(state: EngineState, cfg: EngineConfig["ranking"], now: Date = new Date()): Cluster[] {
  return rankClusters(liveClusters(state), cfg, now)
    .filter((c) => (uniqueSources(c) >= 2 || c.importance >= 3) && score(c, cfg, now) >= cfg.minTopScore)
    .slice(0, cfg.maxTopStories);
}

export function sectionStories(
  state: EngineState,
  section: Section,
  cfg: EngineConfig["ranking"],
  now: Date = new Date()
): Cluster[] {
  return rankClusters(liveClusters(state).filter((c) => c.section === section), cfg, now).slice(
    0,
    cfg.maxSectionStories
  );
}

/** Lead link for a cluster: primary sources (weight) first, earliest coverage breaks ties. */
export function leadLink(cluster: Cluster): Cluster["links"][number] {
  return [...cluster.links].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.weight !== b.weight) return b.weight - a.weight;
    return new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime();
  })[0];
}
