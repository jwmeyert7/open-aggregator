/**
 * A section is any id you define in config/sections.json. It is a plain string,
 * not a fixed set, so the engine stays topic agnostic.
 */
export type Section = string;

export interface FeedConfig {
  id: string;
  name: string;
  url: string;
  type: "rss" | "discourse" | "listing";
  tier: 1 | 2;
  weight: number;
  sectionHint?: Section;
  /** Case-insensitive regex. Matching titles are skipped (e.g. nightly builds). */
  excludePattern?: string;
  /**
   * Case-insensitive regex a title or excerpt must match to be considered at
   * all. The entry ticket for broad feeds. Everything else is dropped locally,
   * before the LLM gate ever sees it, so a firehose feed costs almost nothing.
   */
  includePattern?: string;
  /** listing type only: regex an href must match to count as a post link. */
  linkPattern?: string;
  /** Your own grouping label. Never shown to readers. */
  category?: string;
}

export interface SectionConfig {
  id: Section;
  title: string;
  description: string;
}

export interface EngineConfig {
  sections: SectionConfig[];
  ranking: {
    importanceFactorPerPoint: number;
    decayHalfLifeHours: number;
    velocityWindowHours: number;
    velocityBoostPerLink: number;
    minTopScore: number;
    maxTopStories: number;
    maxSectionStories: number;
  };
  ingest: {
    maxItemAgeHours: number;
    maxItems: number;
    seenHashRetentionDays: number;
    feedTimeoutMs: number;
  };
}

export interface CoverageLink {
  url: string;
  title: string;
  sourceId: string;
  sourceName: string;
  tier: 1 | 2;
  weight: number;
  publishedAt: string;
  addedAt: string;
}

export interface Cluster {
  id: string;
  slug: string;
  headline: string;
  explainer: string;
  section: Section;
  links: CoverageLink[];
  importance: number; // 1 to 5
  keywords: string[];
  createdAt: string;
  updatedAt: string;
}

/** A raw ingested article, kept newest first for the newest rail and pruning. */
export interface Item {
  id: string;
  url: string;
  title: string;
  sourceId: string;
  sourceName: string;
  tier: 1 | 2;
  publishedAt: string;
  ingestedAt: string;
  excerpt?: string;
  clusterId?: string;
}

export interface FeedHealth {
  lastSuccessAt?: string;
  lastErrorAt?: string;
  lastError?: string;
  consecutiveErrors: number;
  lastNewItemAt?: string;
}

/** A candidate fetched from a feed, before dedupe and gating. */
export interface CandidateItem {
  url: string;
  title: string;
  publishedAt: string;
  excerpt?: string;
  /** Community traction on the source platform (Discourse), when known. */
  engagement?: { replies: number; likes: number; views: number };
  sourceId: string;
  sourceName: string;
  tier: 1 | 2;
  weight: number;
  sectionHint?: Section;
}

export interface EngineState {
  v: 1;
  updatedAt: string;
  items: Item[]; // newest first
  seen: Record<string, string>; // url/content hash -> ISO date first seen
  clusters: Record<string, Cluster>;
  feedHealth: Record<string, FeedHealth>;
}

export function emptyState(): EngineState {
  return {
    v: 1,
    updatedAt: new Date(0).toISOString(),
    items: [],
    seen: {},
    clusters: {},
    feedHealth: {},
  };
}
