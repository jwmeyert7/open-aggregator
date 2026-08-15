/**
 * Section ids are config-driven strings from config/sections.json. "general"
 * is the built-in catch-all for multi-topic roundups (weekly newsletter
 * issues): it is a valid cluster section but not a nav section. No section
 * page exists for it, so general stories surface only in Top Stories and the
 * stream.
 */
export type SectionId = string;

/** The one section id that exists without appearing in config/sections.json. */
export const GENERAL_SECTION: SectionId = "general";

export interface FeedConfig {
  id: string;
  name: string;
  url: string;
  type: "rss" | "discourse" | "reddit" | "listing" | "gnews" | "farcaster";
  tier: 1 | 2;
  weight: number;
  sectionHint?: SectionId;
  /** Case-insensitive regex; matching titles are skipped (e.g. nightly builds). */
  excludePattern?: string;
  /**
   * Case-insensitive regex a title or excerpt must match to be considered at
   * all. The entry ticket for firehose feeds (mainstream outlets publishing
   * mostly off-topic news): everything else is dropped locally, before the
   * LLM gate ever sees it, so a broad feed costs almost nothing.
   */
  includePattern?: string;
  /** listing type only: regex an href must match to count as a post link. */
  linkPattern?: string;
  /** Admin-facing grouping only; never shown on the public site. */
  category?: string;
  /** UTC day (YYYY-MM-DD) the source joined the whitelist. Admin-facing only. */
  added?: string;
}

export interface SectionConfig {
  id: SectionId;
  title: string;
  description: string;
}

export interface SiteConfig {
  sections: SectionConfig[];
  ranking: {
    importanceFactorPerPoint: number;
    centralityFactorPerPoint: number;
    /** Score multiplier while a cluster's only source is an open forum. */
    soloForumFactor?: number;
    decayHalfLifeHours: number;
    velocityWindowHours: number;
    velocityBoostPerLink: number;
    minTopScore: number;
    maxTopStories: number;
    maxSectionStories: number;
    /** Items per day below which decay stretches (0 disables adaptive decay). */
    quietInflowPerDay?: number;
    /** Ceiling on the decay half-life multiplier during quiet spells. */
    maxDecayStretch?: number;
    /** Stories in the weekend week-in-review block. */
    maxWeekInReview?: number;
    /**
     * Weekend mode runs from Saturday 00:00 UTC until this hour on Monday,
     * because Monday morning is still catch-up time and inflow has not
     * recovered yet. 0 ends it at midnight Sunday.
     */
    weekendUntilMondayHourUtc?: number;
  };
  ingest: {
    maxItemAgeHours: number;
    riverRetentionDays: number;
    maxRiverItems: number;
    seenHashRetentionDays: number;
    feedSilentDays: number;
    feedTimeoutMs: number;
    digestClusterDays: number;
    digestMaxClusters: number;
  };
  /**
   * House prediction-market story: fires only on exceptional 24h swings in
   * implied probability across a curated list of Polymarket EVENT markets.
   * An empty markets list turns the feature off.
   */
  polymarket?: {
    /** Probability-points swing in 24h that fires a story (e.g. 15 = 15pp). */
    movePointsThreshold: number;
    cooldownHours: number;
    /** Markets thinner than this (USD) are ignored: thin books swing on one trader. */
    minLiquidity: number;
    markets: Array<{ slug: string; label: string; section?: SectionId }>;
  };
  /** Farcaster link discovery: how many casts to read and how weak a signal may carry a link. */
  farcaster?: { castLimit: number; minAuthorFollowers: number; minEngagement: number; candidateRetentionDays: number };
  bots: {
    siteUrl: string;
    /** digestChannel: channel id for the nightly digest cast; empty = no channel (requires channel membership to stick). */
    farcaster: { maxPerDay: number; minScore: number; topN: number; digestChannel?: string };
    x: { maxAutoPerDay: number; maxPerMonth: number; minScore: number };
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
  section: SectionId;
  links: CoverageLink[];
  importance: number; // 1-5
  /** 1-5: how specifically about the site's topic (5 = core subject, 1 = tangential angle). */
  centrality?: number;
  keywords: string[];
  createdAt: string;
  updatedAt: string;
  /** Opinion essay rather than reporting; rendered as a visible label so provenance stays legible. */
  opinion?: boolean;
  pinned?: boolean;
  killed?: boolean;
  mergedInto?: string;
  needsReview?: boolean; // set when created by the no-LLM fallback
  posted?: { x?: string; farcaster?: string; farcasterHash?: string };
  /** Last few re-edit/manual-edit events, newest first, capped small. */
  editHistory?: Array<{ at: string; kind: "reedit" | "manual" | "split"; before: string; after: string }>;
}

export interface RiverItem {
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

export interface Listing {
  id: string;
  title: string;
  url: string;
  org?: string;
  location?: string;
  date?: string; // events only
  featured?: boolean;
  paid?: boolean;
  /** Kept in the admin but not rendered publicly (queued / held back). */
  hidden?: boolean;
  addedAt: string;
}

export interface SponsoredPost {
  id: string;
  headline: string;
  url: string;
  sponsor?: string;
  /** Rendered under the headline like a story explainer. */
  description?: string;
  /** Legacy single placement; superseded by placements. */
  placement?: "top" | SectionId;
  /**
   * Where it appears: any mix of top + sections, OR "sidebar" alone (the
   * middle column, which shows on every story page, so mixing is redundant).
   */
  placements?: Array<"top" | "sidebar" | SectionId>;
  /** Kept in the admin but not rendered publicly (queued / held back). */
  hidden?: boolean;
  addedAt: string;
}

/** Effective placements for a sponsored post, tolerating the legacy single field. */
export function sponsoredPlacements(p: SponsoredPost): Array<"top" | "sidebar" | SectionId> {
  return p.placements ?? [p.placement ?? "top"];
}

export interface RunLogEntry {
  at: string;
  ms: number;
  newItems: number;
  rejected: number;
  /** Sample of what the gate rejected this run, for auditing gate strictness. */
  rejectedSamples?: Array<{ title: string; source: string; reason: string }>;
  clustersCreated: number;
  clustersUpdated: number;
  usedLlm: boolean;
  feedErrors: Array<{ feedId: string; error: string }>;
  posted: string[];
  notes: string[];
  snapshot?: string;
}

export interface XPostRecord {
  clusterId: string;
  postedAt: string;
  manual: boolean;
  dryRun?: boolean;
}

export interface FarcasterPostRecord {
  clusterId: string;
  postedAt: string;
  dryRun?: boolean;
  hash?: string;
}

export interface SiteState {
  v: 1;
  updatedAt: string;
  items: RiverItem[]; // newest first
  seen: Record<string, string>; // url/content hash -> ISO date first seen
  clusters: Record<string, Cluster>;
  feedHealth: Record<string, FeedHealth>;
  xPosts: XPostRecord[];
  farcasterPosts: FarcasterPostRecord[];
  jobs: Listing[];
  events: Listing[];
  podcasts?: Listing[];
  /** Paid announcement slot on the front page; hidden keeps the text but stops rendering it. */
  announcement?: { text: string; url?: string; hidden?: boolean } | null;
  /** Editor-model summary of the current news cycle, shown atop the front page while fresh. */
  frontSummary?: { text: string; at: string };
  /** Paid posts injected into the story lists, clearly marked as ads. */
  sponsoredPosts?: SponsoredPost[];
  /** Admin-managed source changes layered over config/feeds.json. */
  feedOverrides?: {
    custom: FeedConfig[];
    disabled: string[];
    /** Per-source overrides of tier/weight/category, applied over the config file. */
    edits?: Record<string, { tier?: 1 | 2; weight?: number; category?: string }>;
  };
  /** Admin-managed Polymarket market changes layered over config/sections.json. */
  marketOverrides?: {
    custom: Array<{ slug: string; label: string; section?: SectionId }>;
    disabled: string[];
  };
  /** Recent pipeline run reports, newest first, capped. */
  runLog?: RunLogEntry[];
  /** Reader link suggestions awaiting review, newest first. */
  submissions?: Submission[];
  /** UTC day the daily digest was last generated for (guards once-per-day). */
  lastDailyDigest?: string;
  /** Per-Polymarket-slug: the swing story last fired for it (cooldown + killed-stays-killed guard). */
  marketMoves?: Record<string, { clusterId: string; prob: number; at: string }>;
  /** Per-Polymarket-slug rolling ~24h probability baseline, the fallback change signal; url is the market's real event page, learned from the API. */
  marketBaselines?: Record<string, { prob: number; at: string; url?: string }>;
  /**
   * Per-source gate outcomes, bucketed by UTC day so the leaderboard can show
   * a real window instead of all-time totals. Pruned with the rest of state.
   */
  sourceStats?: Record<string, Record<string, { considered: number; accepted: number }>>;
  /**
   * Domains seen linked from Farcaster that no whitelisted source covers.
   * Never published: this is a research queue for deciding what to add.
   */
  sourceCandidates?: Record<string, SourceCandidate>;
  /** Admin-edited weekend-mode window (UTC); absent = the config default. */
  weekendSchedule?: WeekendSchedule;
  /** Readers signed up for the daily and/or weekly email digests. */
  digestSubscribers?: DigestSubscriber[];
  /** UTC Saturday the weekly email last went out (once-per-week guard). */
  lastWeeklyDigest?: string;
  /** Dates (YYYY-MM-DD) with a stored daily digest, newest first. */
  dailyDigestDates?: string[];
  snapshots: string[]; // YYMMDD-HHMM ids, newest last
}

/**
 * The UTC window during which the front page leads with the week instead of
 * the day. Days are 0 (Sunday) through 6 (Saturday); the window may wrap the
 * week boundary (the default Saturday → Monday one does).
 */
export interface WeekendSchedule {
  startDow: number;
  startHour: number;
  endDow: number;
  endHour: number;
}

/** A reader signed up for email digests via /subscribe. */
export interface DigestSubscriber {
  email: string;
  daily: boolean;
  weekly: boolean;
  /** Unsubscribe/confirmation token carried in the email links. */
  token: string;
  addedAt: string;
  /**
   * false until the confirmation link is clicked; nothing sends while false.
   * Absent on subscribers from before double opt-in existed: they are
   * grandfathered as confirmed.
   */
  confirmed?: boolean;
}

/** A reader-suggested link from the public /submit form. */
export interface Submission {
  id: string;
  url: string;
  note?: string;
  email?: string;
  /** Story permalink slug when suggested from a story page. */
  storySlug?: string;
  /** URL host wasn't among configured sources at submission time. */
  newSource: boolean;
  at: string;
  status: "pending" | "approved" | "dismissed";
}

/** How long the editor-model front summary stays on the page before it reads as stale. */
export const FRONT_SUMMARY_MAX_AGE_HOURS = 36;

export interface Snapshot {
  id: string; // YYMMDD-HHMM (UTC)
  takenAt: string;
  clusters: Cluster[]; // live (non-killed) clusters at snapshot time, pre-sorted by rank
  /** The front-page summary as it was showing at snapshot time, when one was fresh. */
  frontSummary?: string;
}

/** One UTC day's best curation, frozen shortly after midnight. */
export interface DailyDigest {
  date: string; // YYYY-MM-DD (UTC)
  takenAt: string;
  clusters: Cluster[]; // the day's top stories, pre-sorted by magnitude
  /** Hash of the digest's Farcaster cast, when it really posted. */
  castHash?: string;
  /** Id of the digest's X post, when it really posted. */
  tweetId?: string;
  /** Editor-model day-in-review paragraph, written once when the digest freezes. */
  summary?: string;
}

/** A domain that Farcaster keeps pointing at while no source of ours covers it. */
export interface SourceCandidate {
  host: string;
  /** Distinct casts seen linking to this domain. */
  casts: number;
  /** Total likes plus replies across those casts, as a rough interest signal. */
  engagement: number;
  /** Highest follower count among the accounts that linked it. */
  topReach: number;
  firstSeen: string;
  lastSeen: string;
  examples: Array<{ url: string; author: string; text: string; at: string }>;
  /** Set when an admin has decided this domain is not worth adding. */
  dismissed?: boolean;
  /** One-time editor read of the domain, written by the pipeline so the admin can judge without opening every example. */
  assessment?: { why: string; sections: SectionId[]; at: string };
}

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
  sectionHint?: SectionId;
  /**
   * gnews items only: the news.google.com link/title the item arrived with,
   * kept after resolution so markSeen can record both forms and the item
   * dedupes on its next fetch.
   */
  origUrl?: string;
  origTitle?: string;
  /** Surfaced by a Farcaster cast rather than by the source's own feed. */
  viaFarcaster?: boolean;
}

export function emptyState(): SiteState {
  return {
    v: 1,
    updatedAt: new Date(0).toISOString(),
    items: [],
    seen: {},
    clusters: {},
    feedHealth: {},
    xPosts: [],
    farcasterPosts: [],
    jobs: [],
    events: [],
    podcasts: [],
    snapshots: [],
  };
}
