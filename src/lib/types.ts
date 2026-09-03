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
  /** youtube and podcast feeds fill the media shelf beside the news flow, never the story pipeline. */
  type: "rss" | "discourse" | "reddit" | "listing" | "gnews" | "farcaster" | "youtube" | "podcast";
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
  /** media feeds only: a regex rewrite applied to every title from this feed at ingest (a show that shouts "ROUNDUP:" reads "Roundup:"). */
  /** the replacement may use {date} for the episode's publish date ("Aug 21"), so a recurring segment can be dated in its title. */
  titleRewrite?: { pattern: string; replacement: string };
  /** media feeds only: episodes whose title matches skip the media gate and shelve with the feed's sectionHint (a recurring show segment that always belongs, like a weekly roundup). */
  alwaysPattern?: string;
  /** media feeds only: what an episode row's tile shows. "episode" (the default) uses the episode's own art; "frame", "frame2", and "frame3" swap in a plain frame from the video itself (YouTube's hq1/hq2/hq3.jpg, roughly the quarter points) for shows whose designed cards are unbearable; "show" drops the image for a flat tile carrying the show's name. Applied to shelved episodes on every pipeline run. */
  thumbStyle?: "episode" | "frame" | "frame2" | "frame3" | "show";
  /** media feeds only: every episode is a roundup spanning the sections. It wears no section label and appears in every section's rail, because a label that applies to everything selects nothing. */
  roundup?: boolean;
  /**
   * podcast feeds only: URL of a slop.computer-style episodes.json sidecar.
   * When the RSS only carries audio, the manifest supplies each episode's
   * direct video file, card thumbnail, and chapter marks, matched by the
   * enclosure filename stem or the item link's last path segment = slug.
   */
  videoManifest?: string;
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
  /** reader-facing one-liner shown under the tabs on the section's own page, and reused (lowercased) on the About page */
  tagline?: string;
  /**
   * Short linked addendum after the tagline, on the section's own page ONLY
   * (never the nav tabs or About). For transient notes, like a coming
   * upgrade: remove it from config when the moment passes.
   */
  taglineNote?: { text: string; linkText: string; href: string };
  /** short hover text on the section's nav tab */
  tooltip?: string;
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
    /** Pickup within this many hours of the story's first report counts in full (default 12). */
    latenessGraceHours?: number;
    /** Past the grace window, a late link's contribution halves per this many hours of lateness (default 36). */
    latenessHalfLifeHours?: number;
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
    /** Most new items handed to one editor call; the rest wait for the next run (unseen, so nothing is lost). */
    maxEditorBatch?: number;
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
    /** dailyThread/weeklyThread/monthlyThread: the two-tweet digest threads on X (tweet 1 the snapshot lines, tweet 2 the archive link). Like the old single digest tweet they ride outside the story caps. */
    x: { maxAutoPerDay: number; maxPerMonth: number; minScore: number; dailyThread?: boolean; weeklyThread?: boolean; monthlyThread?: boolean };
    /**
     * One comment a day in the subreddit's daily discussion thread carrying
     * yesterday's frozen edition. dailyTitlePrefix identifies the thread among
     * the subreddit's stickies. postHourUtc waits for the new daily thread to
     * exist (many appear in the small hours UTC) and for a busy time of day.
     * An empty subreddit or dailyComment false turns the feature off.
     */
    reddit?: { subreddit: string; dailyComment: boolean; dailyTitlePrefix?: string; postHourUtc?: number; topN?: number };
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
  /** the page declared no publish date, so publishedAt is just the moment it was added; such a link never counts toward velocity */
  undated?: boolean;
  /** the writer(s) as the feed named them, when the feed named anyone at all (captured from 2026-09-01) */
  byline?: string;
}

export interface Cluster {
  id: string;
  slug: string;
  headline: string;
  explainer: string;
  section: SectionId;
  /**
   * An optional second section label. One label is the rule; a second is the
   * exception the editor has to justify (a product story that is also a
   * regulatory one). The story lists on both section pages, ranked normally,
   * and wears both pills. Never "general", never equal to section.
   */
  alsoIn?: SectionId;
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
  /** Admin-chosen lead link URL; unset means the automatic tier/weight pick. */
  leadUrl?: string;
  killed?: boolean;
  mergedInto?: string;
  needsReview?: boolean; // set when created by the no-LLM fallback
  posted?: { x?: string; farcaster?: string; farcasterHash?: string };
  /**
   * Episodes whose show notes point at this story (a link to one of its
   * articles, or a chapter whose words match it), with the moment in the
   * episode when known. Rendered as "discussed at 12:34 on {show}".
   */
  mentions?: Array<{ mediaId: string; show: string; title: string; kind: "video" | "podcast"; at?: number; addedAt: string }>;
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
  byline?: string;
}

/**
 * One episode on the media shelf (a video or a podcast episode from a
 * whitelisted show). Media lives beside the news pipeline, never inside it:
 * episodes are commentary by nature, so they are not clustered, never
 * corroborate a story, and skip the news gate. Tier semantics still apply at
 * ingest: tier 1 shows pass through, tier 2 shows face the media gate.
 */
export interface MediaItem {
  id: string;
  kind: "video" | "podcast";
  url: string;
  title: string;
  sourceId: string;
  sourceName: string;
  publishedAt: string;
  ingestedAt: string;
  thumbnail?: string;
  /** copied from the feed's thumbStyle on every pipeline run and on re-judge; absent means the episode's own art */
  thumbStyle?: "frame" | "frame2" | "frame3" | "show";
  /** a roundup episode: no section label, shown in every section's rail (synced from the feed like thumbStyle) */
  roundup?: boolean;
  durationSec?: number;
  /** podcast episodes only: the enclosure audio, so the page can play it natively. */
  audioUrl?: string;
  /** admin-set site title for the rare episode whose own title misleads; the show's title stays in the tooltip and on the watch link. */
  displayTitle?: string;
  /**
   * Show notes, read from the episode's description: links to other pages
   * (platform, shop, and sponsor hosts dropped) and chapter marks ("12:34
   * The new rules"). They tie episodes to stories.
   */
  links?: string[];
  chapters?: Array<{ at: number; label: string; links?: string[] }>;
  /** a scheduled premiere or live stream that has not aired; never shelved, evicted on re-judge */
  upcoming?: boolean;
  /** set once the show notes have been matched against stories */
  notesLinkedAt?: string;
  /** set once the show-note links have been routed as possible coverage */
  linksRoutedAt?: string;
  /** the show's tier at shelve time: tier 1 shows outrank tier 2 in the ranked boxes. */
  tier?: 1 | 2;
  /** YouTube view and like counts at statsAt, refreshed while the episode is young; the ranking's velocity signal. */
  views?: number;
  likes?: number;
  statsAt?: string;
  /** podcast episodes that also exist as a video on the same show's channel: the video url, which the player prefers. */
  videoUrl?: string;
  /** a video hidden because it is the twin of a podcast episode that carries the playback instead. */
  twinOf?: string;
  excerpt?: string;
  /** Section label: the feed's hint for tier 1 shows, the media gate's call for tier 2. A label, not a bucket: the episode lives on /podcasts and also appears in its section's rail. */
  section?: SectionId;
  /** Kept in the admin but not rendered publicly. */
  hidden?: boolean;
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

export interface RedditPostRecord {
  /** the edition's date (YYYY-MM-DD), not the posting day */
  date: string;
  postedAt: string;
  threadId: string;
  threadUrl?: string;
  commentId?: string;
  commentUrl?: string;
  manual?: boolean;
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
  /** consecutive editor-call failures; a streak emails the admin once per outage */
  llmFailStreak?: number;
  /** set while an LLM-outage alert has gone out and calls have not yet recovered */
  llmAlertedAt?: string;
  xPosts: XPostRecord[];
  farcasterPosts: FarcasterPostRecord[];
  /** the daily Reddit comments actually made, newest first (dry runs are not recorded) */
  redditPosts?: RedditPostRecord[];
  /** last try at the Reddit comment, so a failing post retries every half hour instead of every run */
  redditLastAttemptAt?: string;
  jobs: Listing[];
  events: Listing[];
  podcasts?: Listing[];
  /** Paid announcement slot on the front page; hidden keeps the text but stops rendering it. */
  announcement?: { text: string; url?: string; hidden?: boolean } | null;
  /**
   * Editor-model summary of the current news cycle, shown atop the front page
   * while fresh. stale marks it for reconsideration on the next pipeline run
   * (set when an admin action changes a story a line cites, or a cited story
   * dies); still-accurate lines survive that pass verbatim.
   */
  frontSummary?: {
    text: string;
    at: string;
    stale?: boolean;
    /** why the box was flagged stale, echoed into the next rewrite's history line */
    staleReason?: string;
    /** newest first, last 10 times the text actually changed and why */
    history?: Array<{
      at: string;
      reason: string;
      changed: number;
      total: number;
      /** the lines that moved: before and after paired by story where possible */
      diff?: Array<{ section: string; before?: string; after?: string }>;
    }>;
  };
  /** Paid posts injected into the story lists, clearly marked as ads. */
  sponsoredPosts?: SponsoredPost[];
  /** Admin-managed source changes layered over config/feeds.json. */
  feedOverrides?: {
    custom: FeedConfig[];
    disabled: string[];
    /** Per-source overrides of tier/weight/category, applied over the config file. */
    edits?: Record<string, { tier?: 1 | 2; weight?: number; category?: string; thumbStyle?: "episode" | "frame" | "frame2" | "frame3" | "show" }>;
  };
  /** Admin-managed Polymarket market changes layered over config/sections.json. */
  marketOverrides?: {
    custom: Array<{ slug: string; label: string; section?: SectionId }>;
    disabled: string[];
  };
  /** The media shelf: whitelisted-show episodes, newest first, capped. */
  mediaItems?: MediaItem[];
  /** When the media shelf last ingested; episodes need hourly freshness, not the news cadence. */
  lastMediaIngestAt?: string;
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
  /** Owner opt-in: the /sponsor page and its footer link render only when true. */
  sponsorPageEnabled?: boolean;
  /** Readers signed up for the daily and/or weekly email digests. */
  digestSubscribers?: DigestSubscriber[];
  /** UTC Saturday the weekly email last went out (once-per-week guard). */
  lastWeeklyDigest?: string;
  /** Dates (YYYY-MM-DD) with a stored daily digest, newest first. */
  dailyDigestDates?: string[];
  /** Week-end dates (YYYY-MM-DD, the covered Friday) with a stored weekly digest, newest first. */
  weeklyDigestDates?: string[];
  /** Months (YYYY-MM) with a stored monthly digest, newest first. */
  monthlyDigestMonths?: string[];
  /** The month (YYYY-MM) whose 1st-of-month freeze already ran. */
  lastMonthlyDigest?: string;
  /** Years (YYYY) with a stored yearly digest, newest first. */
  yearlyDigestYears?: string[];
  /** The year (YYYY) whose January 1 freeze already ran. */
  lastYearlyDigest?: string;
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
  /**
   * Explicit opt-in only: absent (subscribers from before the checkbox
   * existed) means NOT subscribed. Every frequency is a deliberate choice.
   */
  monthly?: boolean;
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
  /** required by the API for new submissions since 2026-09; older stored ones may lack it */
  email?: string;
  /** Story permalink slug when suggested from a story page. */
  storySlug?: string;
  /** URL host wasn't among configured sources at submission time. */
  newSource: boolean;
  /** the submitter marked it as a news story */
  asStory?: boolean;
  /** the submitter marked it as a source to follow */
  asSource?: boolean;
  /** the submitter's guess at where it belongs (nav section ids) */
  sections?: string[];
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
  /**
   * sha256 of the frozen edition's content (everything except post-freeze
   * bookkeeping: tweetId, castHash, attestationUid, this field). Written once
   * at freeze. The hash an edition NFT or onchain attestation carries as
   * proof of the day's real record.
   */
  contentHash?: string;
  /** UID of the edition's EAS attestation on Base, once one has been made. */
  attestationUid?: string;
  clusters: Cluster[]; // the day's top stories, pre-sorted by magnitude
  /** Hash of the digest's Farcaster cast, when it really posted. */
  castHash?: string;
  /** Id of the digest's X post, when it really posted. */
  tweetId?: string;
  /** Editor-model day-in-review paragraph, written once when the digest freezes. */
  summary?: string;
  /**
   * Stories active that day (new coverage arrived) that broke on an earlier
   * day, so they file elsewhere but belong to this day's experience. Frozen
   * as plain headline links, biggest first.
   */
  alsoActive?: Array<{ headline: string; slug: string; section?: SectionId }>;
  /** The day's top podcast episodes, frozen playable (full items, ranked). */
  episodes?: MediaItem[];
  /** Still the CURRENT day: refreshed every run, replaced by the freeze. */
  inProgress?: boolean;
}

/** One frozen calendar month, frozen on the 1st of the next month. */
export interface MonthlyDigest {
  /** "YYYY-MM", the covered month; the /month URL segment. */
  month: string;
  takenAt: string;
  /** sha256 of the frozen content, as on DailyDigest. */
  contentHash?: string;
  /** UID of the edition's EAS attestation on Base, once one has been made. */
  attestationUid?: string;
  clusters: Cluster[]; // the month's top stories, importance first then magnitude
  /** The month's top podcast episodes, frozen playable (full items, ranked). */
  episodes?: MediaItem[];
  /** Editor-model month-in-review bullets, section-tagged lines, written once at freeze (absent on months frozen before 2026-09-02). */
  summary?: string;
  /** Id of the month's X thread (its first tweet), when it really posted. */
  tweetId?: string;
  /** Still the CURRENT month: refreshed every run, replaced by the freeze. */
  inProgress?: boolean;
}

/**
 * One frozen calendar year, frozen on January 1. Site-only by decision: the
 * year page and word map exist, but no email, tweet, or cast goes out for it.
 */
export interface YearlyDigest {
  /** "YYYY"; the /year URL segment. */
  year: string;
  takenAt: string;
  /** sha256 of the frozen content, as on DailyDigest. */
  contentHash?: string;
  /** UID of the edition's EAS attestation on Base, once one has been made. */
  attestationUid?: string;
  clusters: Cluster[]; // the year's top stories, pooled from the monthly digests
  /** One podcast per month: each frozen month's top episode, in month order. */
  episodes?: MediaItem[];
  /** Still the CURRENT year: refreshed every run, replaced by the freeze. */
  inProgress?: boolean;
}

/** One frozen week: Saturday through Friday, frozen when the weekly email sends. */
export interface WeeklyDigest {
  /** YYYY-MM-DD (UTC), the covered week's Saturday. */
  start: string;
  /** YYYY-MM-DD (UTC), the covered week's Friday; the /week URL segment. */
  end: string;
  takenAt: string;
  /** sha256 of the frozen content, as on DailyDigest. */
  contentHash?: string;
  /** UID of the edition's EAS attestation on Base, once one has been made. */
  attestationUid?: string;
  clusters: Cluster[]; // the week's top stories, importance first then magnitude
  /** The week's top podcast episodes, frozen playable (full items, ranked). */
  episodes?: MediaItem[];
  /** Editor-model week-in-review bullets, section-tagged lines, written once at freeze (absent on weeks frozen before 2026-09-02). */
  summary?: string;
  /** Id of the week's X thread (its first tweet), when it really posted. */
  tweetId?: string;
  /** Still the CURRENT week: refreshed every run, replaced by the freeze. */
  inProgress?: boolean;
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
  /** manual adds only: the page declared no publish date, so the link must not rank as breaking */
  undated?: boolean;
  /** writer(s) named by the feed or page, already cleaned */
  byline?: string;
  /**
   * Release-feed items only: the stripped release notes, carried from ingest
   * to the release-summary step and dropped before the item persists.
   */
  releaseNotes?: string;
  /**
   * gnews items only: the news.google.com link/title the item arrived with,
   * kept after resolution so markSeen can record both forms and the item
   * dedupes on its next fetch.
   */
  origUrl?: string;
  origTitle?: string;
  /** Surfaced by a Farcaster cast rather than by the source's own feed. */
  viaFarcaster?: boolean;
  /** Surfaced by an episode's show notes rather than by the source's own feed: the episode's id. */
  viaEpisode?: string;
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
