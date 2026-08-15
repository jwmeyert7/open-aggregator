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
    .map((i) =>
      candidate(
        feed,
        i.link!,
        i.title!,
        i.isoDate || (i.pubDate ? new Date(i.pubDate).toISOString() : new Date().toISOString()),
        i.contentSnippet || i.content
      )
    );
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
        }
      } catch {
        // best-effort
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
  const targets = items.filter((i) => i.viaFarcaster).slice(0, 12);
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

/** Feeds that are erroring or have gone silent for cfg.feedSilentDays+, feed rot made visible. */
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
    } else if (h.lastNewItemAt && hoursAgo(h.lastNewItemAt) > cfg.feedSilentDays * 24) {
      out.push({ feed, reason: `no new items for ${Math.floor(hoursAgo(h.lastNewItemAt) / 24)} days` });
    } else if (!h.lastNewItemAt && h.lastSuccessAt && hoursAgo(h.lastSuccessAt) > cfg.feedSilentDays * 24) {
      out.push({ feed, reason: "reachable but has never produced an item" });
    }
  }
  return out;
}
