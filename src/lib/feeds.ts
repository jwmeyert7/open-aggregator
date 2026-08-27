import Parser from "rss-parser";
import { siteIdentity } from "./site";
import type { CandidateItem, FeedConfig, SiteConfig, SiteState } from "./types";
import { hoursAgo, isPrivateHost, stripHtml, truncate } from "./util";

/** Polite bot UA naming the deployment so feed owners can see who is reading. */
export function userAgent(): string {
  const s = siteIdentity();
  return `${s.siteName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-bot/1.0 (+https://${s.domain}; feed aggregator)`;
}

export interface FeedFetchResult {
  feed: FeedConfig;
  items: CandidateItem[];
  /** farcaster feeds only: the external links their casts carried. */
  castLinks?: CastLink[];
  error?: string;
}

/** A media-shelf candidate: a news candidate plus what a video/episode carries. */
export interface MediaCandidate extends CandidateItem {
  kind: "video" | "podcast";
  thumbnail?: string;
  durationSec?: number;
  /** podcast episodes: the enclosure audio url. */
  audioUrl?: string;
  /** direct video file from the feed's videoManifest sidecar */
  videoUrl?: string;
  /** a scheduled premiere or live stream that has not aired */
  upcoming?: boolean;
  /** show notes read from the full description */
  descriptionLinks?: string[];
  chapters?: Array<{ at: number; label: string; links?: string[] }>;
}

/** Hosts that show notes link to as a matter of course and that never carry a story: the platforms, the shops, the sponsors' storefronts. */
const NOTE_LINK_DROP = /(^|\.)(youtube\.com|youtu\.be|spotify\.com|apple\.com|podcasts\.apple\.com|google\.com|discord\.gg|discord\.com|t\.me|telegram\.org|twitter\.com|x\.com|instagram\.com|tiktok\.com|linkedin\.com|facebook\.com|patreon\.com|amazon\.com|amzn\.to|bit\.ly|linktr\.ee|substack\.com\/subscribe)$/i;

/** Every http(s) link in a description, minus platform and sponsor hosts, deduped in order. */
export function extractDescriptionLinks(text: string | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/[^\s<>"'()\[\]]+/gi)) {
    let url = m[0].replace(/[.,;:!?]+$/, "");
    try {
      const u = new URL(url);
      if (NOTE_LINK_DROP.test(u.hostname)) continue;
      url = u.toString();
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= 40) break;
  }
  return out;
}

/**
 * Chapter marks in a description: lines that start with a time ("12:34" or
 * "1:02:33", optionally in brackets), then a label. Links on the same line
 * travel with the chapter, which is how a show note ties a story to the
 * moment it is discussed.
 */
export function extractChapters(text: string | undefined): Array<{ at: number; label: string; links?: string[] }> {
  if (!text) return [];
  const out: Array<{ at: number; label: string; links?: string[] }> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const m = line.match(/^[\(\[]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\)\]]?\s*[-\u2013\u2014:|]?\s*(.+)$/);
    if (!m) continue;
    const parts = m[1].split(":").map(Number);
    const at = parts.reduce((acc, n) => acc * 60 + n, 0);
    const links = extractDescriptionLinks(m[2]);
    const label = m[2].replace(/https?:\/\/\S+/g, "").replace(/[\s\-\u2013\u2014:|]+$/, "").trim();
    if (label.length < 4 && links.length === 0) continue;
    out.push({ at, label, ...(links.length > 0 ? { links } : {}) });
    if (out.length >= 60) break;
  }
  return out;
}

export interface MediaFetchResult {
  feed: FeedConfig;
  items: MediaCandidate[];
  error?: string;
}

export function isMediaFeed(f: FeedConfig): boolean {
  return f.type === "youtube" || f.type === "podcast";
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": userAgent(), accept: "application/rss+xml, application/atom+xml, application/json, text/xml, */*" },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/**
 * Standards-forum convention: a proposal drafted before an editor assigns its
 * number is titled with a literal placeholder like "RFC-XXXX" or "EIP-XXXX".
 * Rendered as-is it reads like a redaction bug, so it becomes plain
 * "draft RFC" at ingest.
 */
function labelDraftProposals(title: string): string {
  const out = title.replace(/\b(RFC|PEP|EIP|ERC|RIP|CAIP)[-\s]X{2,5}\b/gi, (_, kind: string) => `draft ${kind.toUpperCase()}`);
  return out.charAt(0).toUpperCase() + out.slice(1);
}

function candidate(feed: FeedConfig, url: string, title: string, publishedAt: string, excerpt?: string): CandidateItem {
  return {
    url,
    title: truncate(labelDraftProposals(stripHtml(title)), 300),
    publishedAt,
    excerpt: excerpt ? truncate(stripHtml(excerpt), 500) : undefined,
    sourceId: feed.id,
    sourceName: feed.name,
    tier: feed.tier,
    weight: feed.weight,
    sectionHint: feed.sectionHint,
  };
}

async function parseFeedXml(xml: string): Promise<Awaited<ReturnType<Parser["parseString"]>>> {
  if (/^\s*(?:<!doctype html|<html)/i.test(xml)) {
    throw new Error("Feed URL returned an HTML page, not a feed (soft 404?)");
  }
  // Some feeds (e.g. Scroll's) ship bare ampersands / broken entities that the
  // strict XML parser rejects: escape anything that isn't a valid entity.
  const sanitized = xml.replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;");
  try {
    return await new Parser().parseString(sanitized);
  } catch {
    // Last resort for feeds with broken HTML inside their content payloads:
    // drop the payloads (we only need title/link/date) and parse again.
    const stripped = sanitized
      .replace(/<content:encoded>[\s\S]*?<\/content:encoded>/gi, "")
      .replace(/<description>[\s\S]*?<\/description>/gi, "<description/>");
    return await new Parser().parseString(stripped);
  }
}

async function fetchRss(feed: FeedConfig, timeoutMs: number): Promise<CandidateItem[]> {
  const parsed = await parseFeedXml(await fetchText(feed.url, timeoutMs));
  return (parsed.items ?? [])
    .filter((i) => i.link && i.title)
    .map((i) => {
      const c = candidate(
        feed,
        i.link!,
        i.title!,
        i.isoDate || (i.pubDate ? new Date(i.pubDate).toISOString() : new Date().toISOString()),
        i.contentSnippet || i.content
      );
      // release-feed entries carry their full notes so the release-summary
      // step can distill themes; the 500-char excerpt is too little for that
      if (isReleaseFeed(feed) && i.content) c.releaseNotes = truncate(stripHtml(i.content), 8000);
      return c;
    });
}

/** GitHub-style software release feeds, whose items get the release-notes treatment. */
export function isReleaseFeed(feed: FeedConfig): boolean {
  return /\/releases\.atom$/.test(feed.url) || /\breleases$/i.test(feed.name);
}

/**
 * Refetches a release feed and returns the stripped notes for one entry, for
 * after-the-fact summaries of an already-ingested release. Undefined when the
 * entry has scrolled out of the feed.
 */
export async function fetchReleaseNotesFor(feed: FeedConfig, entryUrl: string, timeoutMs: number): Promise<string | undefined> {
  const parsed = await parseFeedXml(await fetchText(feed.url, timeoutMs));
  const norm = (u: string) => u.replace(/\/+$/, "");
  const entry = (parsed.items ?? []).find((i) => i.link && norm(i.link) === norm(entryUrl));
  const raw = entry?.content || entry?.contentSnippet;
  return raw ? truncate(stripHtml(raw), 8000) : undefined;
}

/**
 * Google News query feeds (type "gnews") are site-scoped searches like
 * "<your topic> site:apnews.com", the only feed Google offers for outlets
 * that publish no usable RSS. Items arrive as "Headline - Outlet" with a
 * news.google.com redirect link and a description that is just that link
 * again, so the suffix and the excerpt are both stripped here; resolution to
 * the publisher URL happens post-dedupe in enrichGoogleNewsItems. Google pads
 * thin query results with unrelated site content, so give every gnews feed an
 * includePattern (applied in fetchFeed) to keep off-topic titles away from
 * the LLM gate.
 */
async function fetchGnews(feed: FeedConfig, timeoutMs: number): Promise<CandidateItem[]> {
  const items = await fetchRss(feed, timeoutMs);
  // Google's suffix is usually the outlet name, sometimes its domain ("Example.com")
  const suffix = new RegExp(`\\s*-\\s*${feed.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\.com)?\\s*$`, "i");
  return items.map((i) => ({ ...i, title: i.title.replace(suffix, ""), excerpt: undefined }));
}

/**
 * news.google.com/rss/articles links never HTTP-redirect; the page resolves
 * itself via an internal endpoint using a signature+timestamp embedded in its
 * markup. Do the same two requests. Google serves the signed page only to
 * browser-looking user agents, hence the UA override.
 */
async function resolveGoogleNewsUrl(link: string, timeoutMs: number): Promise<string | undefined> {
  const id = new URL(link).pathname.split("/").pop();
  if (!id) return undefined;
  const ua = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };
  const pageRes = await fetch(link, { headers: ua, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  const page = await pageRes.text();
  const sg = page.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = page.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sg || !ts) return undefined;
  const payload = [
    "Fbv4je",
    `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${ts},"${sg}"]`,
  ];
  const res = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
    method: "POST",
    headers: { ...ua, "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: "f.req=" + encodeURIComponent(JSON.stringify([[payload]])),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  const text = await res.text();
  return text.match(/https?:\/\/[^"\\]+/g)?.find((u) => !/google\./.test(new URL(u).hostname));
}

/**
 * Resolve new gnews items to their publisher URLs and backfill real metadata
 * from the article page (paywalled pages still serve OG tags). Best-effort
 * twice over: an unresolved item keeps its news.google.com link, which still
 * opens fine for readers; a resolved item whose article page won't load keeps
 * its feed title. Original link/title are recorded for markSeen.
 */
async function enrichGoogleNewsItems(items: CandidateItem[], feeds: FeedConfig[], timeoutMs: number): Promise<void> {
  const gnewsIds = new Set(feeds.filter((f) => f.type === "gnews").map((f) => f.id));
  const targets = items
    .filter((i) => gnewsIds.has(i.sourceId) && i.url.includes("news.google.com"))
    .slice(0, 10);
  await Promise.all(
    targets.map(async (i) => {
      try {
        const resolved = await resolveGoogleNewsUrl(i.url, timeoutMs);
        if (!resolved) return;
        i.origUrl = i.url;
        i.origTitle = i.title;
        i.url = resolved;
        const meta = await pageMeta(resolved, timeoutMs);
        if (meta.title) i.title = truncate(decodeEntities(stripHtml(meta.title)), 300);
        if (meta.desc) i.excerpt = truncate(decodeEntities(stripHtml(meta.desc)), 500);
      } catch {
        // best-effort
      }
    })
  );
}

/**
 * Hosts that carry no article of their own: image CDNs, social platforms, and
 * the frames/mini-app hosts Farcaster clients embed. Never a source candidate.
 */
const FARCASTER_IGNORED_HOSTS =
  /(^|\.)(imagedelivery\.net|media\.firefly\.land|imgur\.com|i\.imgur\.com|x\.com|twitter\.com|t\.co|warpcast\.com|farcaster\.xyz|supercast\.xyz|zora\.co|opensea\.io|youtube\.com|youtu\.be|t\.me|discord\.gg|linktr\.ee|bit\.ly|tinyurl\.com|paragraph\.xyz\/@[^/]+\/subscribe)$/i;

export interface CastLink {
  url: string;
  host: string;
  author: string;
  reach: number;
  engagement: number;
  text: string;
  at: string;
}

/** www and trailing dots are noise when matching a link against a known source. */
export function normalizeHost(raw: string): string {
  return raw.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

/**
 * Best-effort feed discovery for a bare domain: the Discourse API first (the
 * forums matter here and their JSON is unambiguous), then the homepage's
 * rel=alternate link, then the well-known paths (Substack and Medium use
 * /feed, Ghost /rss/). Whatever is found is fetched and parsed before it is
 * returned, so a hit is a working feed, not a guess. Null means the domain
 * needs a human: no feed, or a listing scrape.
 */
export async function discoverFeed(
  host: string,
  timeoutMs: number
): Promise<{ url: string; type: "rss" | "discourse"; title?: string } | null> {
  if (isPrivateHost(host)) return null;
  const base = `https://${host}`;

  try {
    const latest = JSON.parse(await fetchText(`${base}/latest.json`, timeoutMs));
    if (latest && typeof latest === "object" && "topic_list" in latest) {
      let title: string | undefined;
      try {
        title = JSON.parse(await fetchText(`${base}/about.json`, timeoutMs))?.about?.title;
      } catch {}
      return { url: `${base}/latest.json`, type: "discourse", ...(title ? { title } : {}) };
    }
  } catch {}

  const verify = async (url: string): Promise<{ url: string; type: "rss"; title?: string } | null> => {
    try {
      const parsed = await parseFeedXml(await fetchText(url, timeoutMs));
      const title = parsed.title?.trim();
      return { url, type: "rss", ...(title ? { title } : {}) };
    } catch {
      return null;
    }
  };

  try {
    const html = await fetchText(base, timeoutMs);
    for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
      if (!/rel=["']?alternate\b/i.test(tag) || !/application\/(?:rss|atom)\+xml/i.test(tag)) continue;
      const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
      if (!href) continue;
      const found = await verify(new URL(href, base).toString());
      if (found) return found;
    }
  } catch {}

  for (const path of ["/feed", "/rss/", "/feed.xml", "/rss.xml", "/atom.xml", "/index.xml"]) {
    const found = await verify(base + path);
    if (found) return found;
  }
  return null;
}

/**
 * Casts from a Farcaster channel, reduced to the external links they carry.
 * The cast itself is never a story: social posts are opinion by default, which
 * the editorial gate rejects. What travels is the LINK, which either belongs to
 * a source we already trust (a discovery net that also works at weekends) or
 * flags a domain worth evaluating as a new source.
 *
 * url format: "channel:<id>". Thresholds keep spam and small accounts out.
 */
async function fetchFarcasterLinks(
  feed: FeedConfig,
  cfg: SiteConfig["farcaster"],
  timeoutMs: number
): Promise<CastLink[]> {
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) throw new Error("NEYNAR_API_KEY is not configured");
  const channel = feed.url.replace(/^channel:/, "");
  const res = await fetch(
    `https://api.neynar.com/v2/farcaster/feed/channels?channel_ids=${encodeURIComponent(channel)}&with_recasts=false&limit=${cfg?.castLimit ?? 50}`,
    { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" }
  );
  if (!res.ok) throw new Error(`Neynar ${res.status}`);
  const json = (await res.json()) as {
    casts?: Array<{
      text?: string;
      timestamp?: string;
      author?: { username?: string; follower_count?: number };
      embeds?: Array<{ url?: string }>;
      reactions?: { likes_count?: number };
      replies?: { count?: number };
    }>;
  };
  const minReach = cfg?.minAuthorFollowers ?? 0;
  const minEngagement = cfg?.minEngagement ?? 0;
  const out: CastLink[] = [];
  for (const cast of json.casts ?? []) {
    const reach = cast.author?.follower_count ?? 0;
    const engagement = (cast.reactions?.likes_count ?? 0) + (cast.replies?.count ?? 0);
    // one weak signal is allowed to carry a link, but not none of them
    if (reach < minReach && engagement < minEngagement) continue;
    const at = cast.timestamp ? new Date(cast.timestamp).toISOString() : new Date().toISOString();
    for (const embed of cast.embeds ?? []) {
      if (!embed.url || !/^https?:\/\//i.test(embed.url)) continue;
      let host: string;
      try {
        host = normalizeHost(new URL(embed.url).hostname);
      } catch {
        continue;
      }
      if (FARCASTER_IGNORED_HOSTS.test(host)) continue;
      // images are not articles
      if (/\.(png|jpe?g|gif|webp|mp4|mov|svg)(\?|$)/i.test(embed.url)) continue;
      out.push({
        url: embed.url,
        host,
        author: cast.author?.username ?? "unknown",
        reach,
        engagement,
        text: truncate(stripHtml(cast.text ?? ""), 240),
        at,
      });
    }
  }
  return out;
}

/**
 * Discourse list endpoints carry no post bodies, so items from those feeds
 * arrive title-only. Backfill excerpts for a small batch of items by fetching
 * each topic's own JSON endpoint and taking the first post's text. Best-effort:
 * a failed fetch leaves the item title-only, which is still usable.
 */
async function enrichDiscourseExcerpts(items: CandidateItem[], feeds: FeedConfig[], timeoutMs: number): Promise<void> {
  const discourseIds = new Set(feeds.filter((f) => f.type === "discourse").map((f) => f.id));
  const targets = items.filter((i) => (!i.excerpt || !i.engagement) && discourseIds.has(i.sourceId)).slice(0, 20);
  await Promise.all(
    targets.map(async (i) => {
      try {
        const json = JSON.parse(await fetchText(`${i.url}.json`, timeoutMs));
        const cooked: string = json?.post_stream?.posts?.[0]?.cooked ?? "";
        if (cooked && !i.excerpt) i.excerpt = truncate(stripHtml(cooked), 500);
        i.engagement = {
          replies: json?.reply_count ?? 0,
          likes: json?.like_count ?? 0,
          views: json?.views ?? 0,
        };
      } catch {
        // best-effort
      }
    })
  );
}

/**
 * Fallback for team blogs that publish no feed at all (e.g. aztec.network):
 * scrape the listing page for links matching linkPattern. Such pages carry no
 * publish dates, so publishedAt is the discovery time; the pipeline baselines
 * a listing feed's first crawl so pre-existing posts never ingest as fresh
 * news, and enrichListingPages fills real titles/excerpts from each post page.
 */
async function fetchListing(feed: FeedConfig, timeoutMs: number): Promise<CandidateItem[]> {
  if (!feed.linkPattern) throw new Error("listing feed needs linkPattern");
  const origin = new URL(feed.url).origin;
  const html = await fetchText(feed.url, timeoutMs);
  const pattern = new RegExp(feed.linkPattern);
  // page anchors, plus sitemap <loc> entries so a sitemap URL works as a listing
  const links = [...html.matchAll(/href="([^"#?]+)"/g), ...html.matchAll(/<loc>([^<]+)<\/loc>/g)];
  const urls = [
    ...new Set(
      links
        .map((m) => m[1])
        .filter((h) => pattern.test(h))
        .map((h) => (h.startsWith("http") ? h : origin + h))
    ),
  ].slice(0, 15);
  const now = new Date().toISOString();
  return urls.map((u) => candidate(feed, u, (u.split("/").filter(Boolean).pop() ?? u).replace(/-/g, " "), now));
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** og:title / og:description / article:published_time from an article page. */
async function pageMeta(url: string, timeoutMs: number): Promise<{ title?: string; desc?: string; published?: string }> {
  const html = await fetchText(url, timeoutMs);
  // attribute order varies: <meta property=".." content=".."> and the reverse
  const meta = (name: string) =>
    html.match(new RegExp(`<meta[^>]+(?:property|name)="${name}"[^>]+content="([^"]*)"`, "i"))?.[1] ??
    html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${name}"`, "i"))?.[1];
  return {
    title: meta("og:title") ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1],
    desc: meta("og:description") ?? meta("description"),
    published: meta("article:published_time"),
  };
}

/** Replace listing items' slug-derived titles with the post page's real metadata. */
async function enrichListingPages(items: CandidateItem[], feeds: FeedConfig[], timeoutMs: number): Promise<void> {
  const listingIds = new Set(feeds.filter((f) => f.type === "listing").map((f) => f.id));
  const targets = items.filter((i) => listingIds.has(i.sourceId)).slice(0, 20);
  await Promise.all(
    targets.map(async (i) => {
      try {
        const meta = await pageMeta(i.url, timeoutMs);
        if (meta.title) i.title = truncate(decodeEntities(stripHtml(meta.title)), 300);
        if (meta.desc && !i.excerpt) i.excerpt = truncate(decodeEntities(stripHtml(meta.desc)), 500);
        if (meta.published && !Number.isNaN(Date.parse(meta.published))) {
          i.publishedAt = new Date(meta.published).toISOString();
        } else {
          // the page declares no date, so the cast's timestamp stands in: the
          // item must not count as breaking news off a re-share (a month-old
          // Uniswap explainer once resurrected its story to the top this way)
          i.undated = true;
        }
      } catch {
        i.undated = true;
      }
    })
  );
}

/**
 * Farcaster-surfaced links arrive labelled with the cast's text, which is
 * someone's comment rather than the article's headline. Replace it with the
 * article's own metadata so the editor judges the piece and not the sharer.
 */
async function enrichFarcasterItems(items: CandidateItem[], timeoutMs: number): Promise<void> {
  const targets = items.filter((i) => i.viaFarcaster || i.viaEpisode).slice(0, 12);
  await Promise.all(
    targets.map(async (i) => {
      try {
        const meta = await pageMeta(i.url, timeoutMs);
        if (meta.title) i.title = truncate(decodeEntities(stripHtml(meta.title)), 300);
        if (meta.desc) i.excerpt = truncate(decodeEntities(stripHtml(meta.desc)), 500);
        if (meta.published && !Number.isNaN(Date.parse(meta.published))) {
          i.publishedAt = new Date(meta.published).toISOString();
        }
      } catch {
        // best-effort
      }
    })
  );
}

/** All post-dedupe candidate enrichment: runs before the LLM sees the batch. */
export async function enrichNewItems(items: CandidateItem[], feeds: FeedConfig[], timeoutMs: number): Promise<void> {
  await Promise.all([
    enrichDiscourseExcerpts(items, feeds, timeoutMs),
    enrichListingPages(items, feeds, timeoutMs),
    enrichGoogleNewsItems(items, feeds, timeoutMs),
    enrichFarcasterItems(items, timeoutMs),
  ]);
}

async function fetchDiscourse(feed: FeedConfig, timeoutMs: number): Promise<CandidateItem[]> {
  const origin = new URL(feed.url).origin;
  const json = JSON.parse(await fetchText(feed.url, timeoutMs));
  const topics: Array<{ id: number; slug: string; title: string; created_at: string; pinned?: boolean }> =
    json?.topic_list?.topics ?? [];
  return topics
    .filter((t) => !t.pinned)
    .map((t) => candidate(feed, `${origin}/t/${t.slug}/${t.id}`, t.title, t.created_at));
}

async function fetchReddit(feed: FeedConfig, timeoutMs: number): Promise<CandidateItem[]> {
  const json = JSON.parse(await fetchText(feed.url, timeoutMs));
  const posts: Array<{ data: Record<string, unknown> }> = json?.data?.children ?? [];
  return posts
    .map((p) => p.data)
    .filter((d) => d.title && !d.stickied && !d.over_18)
    .map((d) => {
      const permalink = `https://www.reddit.com${d.permalink as string}`;
      const isSelf = Boolean(d.is_self);
      // Link posts point at external news: use the target URL so the same
      // article dedupes/clusters across subreddits and feeds.
      const url = !isSelf && typeof d.url === "string" && (d.url as string).startsWith("http") ? (d.url as string) : permalink;
      const created = new Date((d.created_utc as number) * 1000).toISOString();
      return candidate(feed, url, d.title as string, created, (d.selftext as string) || undefined);
    });
}

/**
 * Media episodes may ingest this far back, so a newly whitelisted show fills
 * the shelf on its first crawl instead of waiting for its next upload. News
 * items use the much shorter maxItemAgeHours: staleness matters for news,
 * while a week-old episode is still perfectly watchable.
 */
const MEDIA_MAX_AGE_DAYS = 14;

/** Even event channels that dump a whole conference at once ingest gradually. */
const MEDIA_MAX_PER_FEED_PER_RUN = 10;

/**
 * YouTube's per-channel feed (youtube.com/feeds/videos.xml?channel_id=UC...):
 * plain Atom plus a media:group per entry carrying the description and
 * thumbnail. No API key and no quota, which is the whole reason the media
 * shelf can exist at zero marginal cost.
 */
async function fetchYoutubeMedia(feed: FeedConfig, timeoutMs: number): Promise<MediaCandidate[]> {
  const xml = await fetchText(feed.url, timeoutMs);
  const parser: Parser = new Parser({
    customFields: { item: [["media:group", "mediaGroup"], ["yt:videoId", "videoId"]] },
  });
  const parsed = await parser.parseString(xml);
  return (parsed.items ?? [])
    .filter((i) => i.link && i.title && !isYoutubeShort(i.link))
    .map((i) => {
      const item = i as typeof i & {
        mediaGroup?: Record<string, Array<string | { $?: { url?: string } }>>;
        videoId?: string;
      };
      const mg = item.mediaGroup ?? {};
      const descRaw = mg["media:description"]?.[0];
      const desc = typeof descRaw === "string" ? descRaw : undefined;
      const thumbRaw = mg["media:thumbnail"]?.[0];
      const thumbnail =
        (typeof thumbRaw === "object" ? thumbRaw?.$?.url : undefined) ??
        (item.videoId ? `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg` : undefined);
      const descriptionLinks = extractDescriptionLinks(desc);
      const chapters = extractChapters(desc);
      return {
        ...candidate(feed, i.link!, i.title!, i.isoDate || new Date().toISOString(), desc),
        kind: "video" as const,
        ...(thumbnail ? { thumbnail } : {}),
        ...(descriptionLinks.length > 0 ? { descriptionLinks } : {}),
        ...(chapters.length > 0 ? { chapters } : {}),
      };
    });
}

/** The v= id of a YouTube watch URL, or null for anything else. */
export function youtubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (/(^|\.)youtu\.be$/.test(u.hostname)) return u.pathname.slice(1).split("/")[0] || null;
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{6,})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** YouTube Shorts are clips, not episodes; a shelf called Podcasts does not carry them. */
export function isYoutubeShort(url: string): boolean {
  return /youtube\.com\/shorts\//.test(url);
}

/** ISO 8601 duration (PT1H2M3S) to seconds. */
function parseIsoDuration(raw?: string): number | undefined {
  const m = raw?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return undefined;
  const [, d, h, mi, se] = m.map((x) => Number(x ?? 0));
  return d * 86400 + h * 3600 + mi * 60 + se || undefined;
}

/**
 * Episode lengths for YouTube videos, which the RSS feed never carries. With
 * YOUTUBE_API_KEY set, one Data API call per 50 ids (one quota unit each,
 * ten thousand a day free). Without it, the watch page is fetched and its
 * player response read for lengthSeconds: heavier (about a megabyte each), so
 * capped per call, and best effort throughout (datacenter egress is often
 * refused). Returns only what it found.
 */
export interface YoutubeDetails {
  durationSec?: number;
  views?: number;
  likes?: number;
  /** the full description, when asked for (the feed's copy is kept only in part) */
  description?: string;
  /** snippet fields, present when the description was asked for */
  title?: string;
  channel?: string;
  channelId?: string;
  publishedAt?: string;
  /** a scheduled premiere or live stream that has not aired: not an episode yet */
  upcoming?: boolean;
  /** when a live stream or premiere actually happened, which is its honest publish time */
  airedAt?: string;
}

export async function fetchYoutubeDetails(
  ids: string[],
  timeoutMs: number,
  scrapeCap = 20,
  withDescription = false
): Promise<Map<string, YoutubeDetails>> {
  const out = new Map<string, YoutubeDetails>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return out;
  const key = process.env.YOUTUBE_API_KEY;
  if (key) {
    for (let i = 0; i < unique.length; i += 50) {
      const chunk = unique.slice(i, i + 50);
      try {
        const parts = withDescription
          ? "contentDetails,statistics,snippet,liveStreamingDetails"
          : "contentDetails,statistics,liveStreamingDetails";
        const url = `https://www.googleapis.com/youtube/v3/videos?part=${parts}&id=${chunk.join(",")}&key=${key}`;
        const json = JSON.parse(await fetchText(url, timeoutMs)) as {
          items?: Array<{
            id: string;
            contentDetails?: { duration?: string };
            statistics?: { viewCount?: string; likeCount?: string };
            snippet?: { description?: string; title?: string; channelTitle?: string; channelId?: string; publishedAt?: string };
            liveStreamingDetails?: { scheduledStartTime?: string; actualStartTime?: string; actualEndTime?: string };
          }>;
        };
        for (const v of json.items ?? []) {
          const sec = parseIsoDuration(v.contentDetails?.duration);
          const views = Number(v.statistics?.viewCount);
          const likes = Number(v.statistics?.likeCount);
          out.set(v.id, {
            ...(sec ? { durationSec: sec } : {}),
            ...(Number.isFinite(views) ? { views } : {}),
            ...(Number.isFinite(likes) ? { likes } : {}),
            ...(withDescription && v.snippet?.description ? { description: v.snippet.description } : {}),
            ...(withDescription && v.snippet
              ? {
                  ...(v.snippet.title ? { title: v.snippet.title } : {}),
                  ...(v.snippet.channelTitle ? { channel: v.snippet.channelTitle } : {}),
                  ...(v.snippet.channelId ? { channelId: v.snippet.channelId } : {}),
                  ...(v.snippet.publishedAt ? { publishedAt: v.snippet.publishedAt } : {}),
                }
              : {}),
            ...((): Partial<YoutubeDetails> => {
              const live = v.liveStreamingDetails;
              if (!live) return {};
              if (!live.actualStartTime && live.scheduledStartTime) return { upcoming: true };
              const airedAt = live.actualEndTime ?? live.actualStartTime;
              return airedAt ? { airedAt } : {};
            })(),
          });
        }
      } catch {
        // best effort: a failed chunk just stays unknown
      }
    }
    return out;
  }
  for (const id of unique.slice(0, scrapeCap)) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
          "Accept-Language": "en",
        },
      });
      clearTimeout(t);
      if (!res.ok) continue;
      const html = await res.text();
      const m = html.match(/"lengthSeconds":"(\d+)"/) ?? html.match(/<meta itemprop="duration" content="([^"]+)"/);
      const sec = m ? (/^\d+$/.test(m[1]) ? Number(m[1]) : parseIsoDuration(m[1])) : undefined;
      const vm = html.match(/"viewCount":"(\d+)"/);
      const views = vm ? Number(vm[1]) : undefined;
      if (sec || views) out.set(id, { ...(sec ? { durationSec: sec } : {}), ...(views ? { views } : {}) });
    } catch {
      // best effort
    }
  }
  return out;
}

/** "1:02:33", "62:33", or bare seconds: podcast feeds use all three. */
function parseItunesDuration(raw?: string): number | undefined {
  if (!raw) return undefined;
  const parts = raw.trim().split(":").map(Number);
  if (parts.length === 0 || parts.some((n) => Number.isNaN(n))) return undefined;
  return parts.reduce((acc, n) => acc * 60 + n, 0) || undefined;
}

/** Standard podcast RSS: enclosure audio plus the itunes tags rss-parser already reads. */
async function fetchPodcastMedia(feed: FeedConfig, timeoutMs: number): Promise<MediaCandidate[]> {
  const parsed = await parseFeedXml(await fetchText(feed.url, timeoutMs));
  const manifest = await fetchVideoManifest(feed, timeoutMs);
  // the manifest keys on the episode slug: the enclosure's filename stem
  // and the item link's last path segment are both tried
  const stem = (u?: string): string | null => {
    if (!u) return null;
    try {
      const parsedUrl = new URL(u);
      const fname = parsedUrl.searchParams.get("filename");
      if (fname) return fname.replace(/\.[a-z0-9]+$/i, "");
      return parsedUrl.pathname.split("/").filter(Boolean).pop() ?? null;
    } catch {
      return null;
    }
  };
  const matched = new Set<string>();
  const fromRss = (parsed.items ?? [])
    .filter((i) => i.title && (i.link || i.enclosure?.url))
    .map((i) => {
      const itunes = (i as { itunes?: { duration?: string; image?: string; summary?: string } }).itunes ?? {};
      const durationSec = parseItunesDuration(itunes.duration);
      const key = [stem(i.enclosure?.url), stem(i.link)].find((k) => k && manifest?.has(k)) ?? null;
      const extra = key ? manifest!.get(key)! : null;
      if (key) matched.add(key);
      return {
        ...candidate(
          feed,
          i.link || i.enclosure!.url,
          i.title!,
          i.isoDate || (i.pubDate ? new Date(i.pubDate).toISOString() : new Date().toISOString()),
          i.contentSnippet || itunes.summary
        ),
        kind: "podcast" as const,
        ...(itunes.image ? { thumbnail: itunes.image } : {}),
        ...(durationSec ? { durationSec } : {}),
        ...(i.enclosure?.url ? { audioUrl: i.enclosure.url } : {}),
        ...((): Partial<MediaCandidate> => {
          // podcast feeds carry show notes as HTML in content, plain in the snippet
          const full = `${i.content ?? ""}\n${i.contentSnippet ?? ""}\n${itunes.summary ?? ""}`;
          const descriptionLinks = extractDescriptionLinks(full);
          const chapters = extractChapters(stripHtml(i.content ?? "").replace(/\s(?=\(?\d{1,2}:\d{2})/g, "\n") + "\n" + (i.contentSnippet ?? ""));
          return { ...(descriptionLinks.length > 0 ? { descriptionLinks } : {}), ...(chapters.length > 0 ? { chapters } : {}) };
        })(),
        // the manifest's video file, card art, and chapter marks win over the
        // RSS-derived ones; with a video the episode IS a video on the site
        ...(extra?.videoUrl ? { kind: "video" as const, videoUrl: extra.videoUrl } : {}),
        ...(extra?.thumbnail ? { thumbnail: extra.thumbnail } : {}),
        ...(extra?.chapters && extra.chapters.length > 0 ? { chapters: extra.chapters } : {}),
      };
    });
  // video-only episodes never reach the RSS (it lists audio enclosures), so
  // the manifest is a first-class source for the rest: anything published
  // with a video that no RSS item claimed becomes its own candidate
  const fromManifest = manifest
    ? [...manifest.values()]
        .filter((e) => !matched.has(e.slug) && e.videoUrl && e.publishedAt)
        .map((e) => ({
          ...candidate(feed, e.pageUrl ?? e.videoUrl!, e.title ?? e.slug, e.publishedAt!, e.excerpt),
          kind: "video" as const,
          videoUrl: e.videoUrl!,
          ...(e.thumbnail ? { thumbnail: e.thumbnail } : {}),
          ...(e.chapters && e.chapters.length > 0 ? { chapters: e.chapters } : {}),
        }))
    : [];
  return [...fromRss, ...fromManifest];
}

export interface ManifestEpisode {
  slug: string;
  title?: string;
  /** the episode's air time (the manifest's unix datetime) */
  publishedAt?: string;
  /** the episode's page on the show's own site */
  pageUrl?: string;
  excerpt?: string;
  videoUrl?: string;
  thumbnail?: string;
  chapters?: Array<{ at: number; label: string }>;
}

/**
 * A podcast feed's optional episodes.json sidecar (the slop.computer schema):
 * per-episode direct video files, card art, chapter marks, and the
 * video-only episodes the RSS never lists. Best-effort: any failure leaves
 * the RSS-only ingest intact.
 */
export async function fetchVideoManifest(feed: FeedConfig, timeoutMs: number): Promise<Map<string, ManifestEpisode> | null> {
  if (!feed.videoManifest) return null;
  try {
    const json = JSON.parse(await fetchText(feed.videoManifest, timeoutMs)) as {
      source?: { gateway?: string };
      episodes?: Array<{
        slug?: string;
        title?: string;
        description?: string;
        datetime?: number;
        live?: boolean;
        page?: string;
        chapters?: Array<{ tStart?: number; title?: string }>;
        media?: { video?: { url?: string }; card?: { url?: string; previewCid?: string } };
      }>;
    };
    const gateway = json.source?.gateway?.replace(/\/$/, "");
    const map = new Map<string, ManifestEpisode>();
    for (const e of json.episodes ?? []) {
      // an episode currently live (or not yet aired, no pinned video) waits
      if (!e.slug || e.live) continue;
      const video = e.media?.video?.url;
      // the card's preview rendition when the gateway is known (the full card
      // runs megabytes); the full card as fallback
      const thumbnail =
        e.media?.card?.previewCid && gateway
          ? `${gateway}/${e.media.card.previewCid}?filename=${encodeURIComponent(e.slug)}.png`
          : e.media?.card?.url;
      const chapters = (e.chapters ?? [])
        .filter((c) => typeof c.tStart === "number" && c.title)
        .map((c) => ({ at: Math.max(0, Math.round(c.tStart!)), label: String(c.title) }));
      map.set(e.slug, {
        slug: e.slug,
        ...(e.title ? { title: e.title } : {}),
        ...(typeof e.datetime === "number" && e.datetime > 0
          ? { publishedAt: new Date(e.datetime * 1000).toISOString() }
          : {}),
        ...(e.page ? { pageUrl: e.page } : {}),
        ...(e.description ? { excerpt: e.description } : {}),
        ...(video ? { videoUrl: video } : {}),
        ...(thumbnail ? { thumbnail } : {}),
        ...(chapters.length > 0 ? { chapters } : {}),
      });
    }
    return map;
  } catch {
    return null;
  }
}

/**
 * All media feeds, each with the same age/pattern filters news feeds get.
 * Fetched SEQUENTIALLY on purpose: they are almost all youtube.com, and a
 * parallel burst of a dozen requests trips YouTube's rate limiter into
 * 404/500s (observed at build time). One at a time stays under it.
 */
export async function fetchMediaFeeds(feeds: FeedConfig[], cfg: SiteConfig["ingest"]): Promise<MediaFetchResult[]> {
  const out: MediaFetchResult[] = [];
  for (const feed of feeds) {
    out.push(
      await (async (): Promise<MediaFetchResult> => {
        try {
          let items =
            feed.type === "youtube"
              ? await fetchYoutubeMedia(feed, cfg.feedTimeoutMs)
              : await fetchPodcastMedia(feed, cfg.feedTimeoutMs);
          items = items.filter((i) => {
            const age = hoursAgo(i.publishedAt);
            return age >= -1 && age <= MEDIA_MAX_AGE_DAYS * 24;
          });
          if (feed.excludePattern) {
            const re = new RegExp(feed.excludePattern, "i");
            items = items.filter((i) => !re.test(i.title));
          }
          if (feed.includePattern) {
            const re = new RegExp(feed.includePattern, "i");
            items = items.filter((i) => re.test(`${i.title} ${i.excerpt ?? ""}`));
          }
          items = items
            .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
            .slice(0, MEDIA_MAX_PER_FEED_PER_RUN);
          return { feed, items };
        } catch (err) {
          return { feed, items: [], error: err instanceof Error ? err.message : String(err) };
        }
      })()
    );
  }
  return out;
}

export async function fetchFeed(
  feed: FeedConfig,
  cfg: SiteConfig["ingest"],
  fcCfg?: SiteConfig["farcaster"]
): Promise<FeedFetchResult> {
  try {
    let items: CandidateItem[];
    switch (feed.type) {
      case "discourse":
        items = await fetchDiscourse(feed, cfg.feedTimeoutMs);
        break;
      case "reddit":
        items = await fetchReddit(feed, cfg.feedTimeoutMs);
        break;
      case "listing":
        items = await fetchListing(feed, cfg.feedTimeoutMs);
        break;
      case "gnews":
        items = await fetchGnews(feed, cfg.feedTimeoutMs);
        break;
      case "farcaster": {
        // links only: attribution and routing happen in the pipeline, which
        // knows which domains our existing sources already cover
        const links = await fetchFarcasterLinks(feed, fcCfg, cfg.feedTimeoutMs);
        return { feed, items: [], castLinks: links };
      }
      default:
        items = await fetchRss(feed, cfg.feedTimeoutMs);
    }
    // Don't backfill history: only items fresh enough to be news.
    items = items.filter((i) => {
      const age = hoursAgo(i.publishedAt);
      return age >= -1 && age <= cfg.maxItemAgeHours;
    });
    if (feed.excludePattern) {
      const re = new RegExp(feed.excludePattern, "i");
      items = items.filter((i) => !re.test(i.title));
    }
    if (feed.includePattern) {
      const re = new RegExp(feed.includePattern, "i");
      items = items.filter((i) => re.test(`${i.title} ${i.excerpt ?? ""}`));
    }
    return { feed, items };
  } catch (err) {
    return { feed, items: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchAllFeeds(
  feeds: FeedConfig[],
  cfg: SiteConfig["ingest"],
  fcCfg?: SiteConfig["farcaster"]
): Promise<FeedFetchResult[]> {
  return Promise.all(feeds.map((f) => fetchFeed(f, cfg, fcCfg)));
}

export function updateFeedHealth(state: SiteState, results: FeedFetchResult[], newItemSourceIds: Set<string>): void {
  const now = new Date().toISOString();
  for (const r of results) {
    const h = state.feedHealth[r.feed.id] ?? { consecutiveErrors: 0 };
    if (r.error) {
      h.lastErrorAt = now;
      h.lastError = r.error;
      h.consecutiveErrors += 1;
    } else {
      h.lastSuccessAt = now;
      h.consecutiveErrors = 0;
      if (newItemSourceIds.has(r.feed.id)) h.lastNewItemAt = now;
    }
    state.feedHealth[r.feed.id] = h;
  }
}

/**
 * Days without a new item before a feed counts as silent. Software release
 * feeds ship every few weeks by nature, so a month of quiet is normal there
 * and only a hard error is worth a look.
 */
function silentDays(feed: FeedConfig, cfg: SiteConfig["ingest"]): number {
  return isReleaseFeed(feed) ? Math.max(cfg.feedSilentDays, 45) : cfg.feedSilentDays;
}

/** Feeds that are erroring or have gone silent for their silent threshold: feed rot made visible. */
export function unhealthyFeeds(state: SiteState, feeds: FeedConfig[], cfg: SiteConfig["ingest"]): Array<{ feed: FeedConfig; reason: string }> {
  const out: Array<{ feed: FeedConfig; reason: string }> = [];
  for (const feed of feeds) {
    const h = state.feedHealth[feed.id];
    if (!h) continue;
    if (h.consecutiveErrors >= 3) {
      out.push({ feed, reason: `${h.consecutiveErrors} consecutive errors (last: ${h.lastError})` });
    } else if (feed.type === "gnews" || feed.type === "farcaster") {
      // query and discovery feeds are quiet by design: a stretch with nothing
      // new is normal, not rot, so only hard errors above count against them
    } else if (h.lastNewItemAt && hoursAgo(h.lastNewItemAt) > silentDays(feed, cfg) * 24) {
      out.push({ feed, reason: `no new items for ${Math.floor(hoursAgo(h.lastNewItemAt) / 24)} days` });
    } else if (!h.lastNewItemAt && h.lastSuccessAt && hoursAgo(h.lastSuccessAt) > silentDays(feed, cfg) * 24) {
      out.push({ feed, reason: "reachable but has never produced an item" });
    }
  }
  return out;
}
