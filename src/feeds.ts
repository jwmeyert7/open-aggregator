import Parser from "rss-parser";
import type { CandidateItem, EngineConfig, EngineState, FeedConfig } from "./types";
import { hoursAgo, stripHtml, truncate } from "./util";

const USER_AGENT = "open-aggregator/1.0 (feed aggregator)";

export interface FeedFetchResult {
  feed: FeedConfig;
  items: CandidateItem[];
  error?: string;
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/atom+xml, application/json, text/xml, */*" },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function candidate(feed: FeedConfig, url: string, title: string, publishedAt: string, excerpt?: string): CandidateItem {
  return {
    url,
    title: truncate(stripHtml(title), 300),
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
  // Some feeds ship bare ampersands or broken entities that the strict XML
  // parser rejects. Escape anything that is not a valid entity.
  const sanitized = xml.replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;");
  try {
    return await new Parser().parseString(sanitized);
  } catch {
    // Last resort for feeds with broken HTML inside their content payloads:
    // drop the payloads (we only need title, link, and date) and parse again.
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

async function fetchDiscourse(feed: FeedConfig, timeoutMs: number): Promise<CandidateItem[]> {
  const origin = new URL(feed.url).origin;
  const json = JSON.parse(await fetchText(feed.url, timeoutMs));
  const topics: Array<{ id: number; slug: string; title: string; created_at: string; pinned?: boolean }> =
    json?.topic_list?.topics ?? [];
  return topics
    .filter((t) => !t.pinned)
    .map((t) => candidate(feed, `${origin}/t/${t.slug}/${t.id}`, t.title, t.created_at));
}

/**
 * Fallback for sites that publish no feed at all: scrape the listing page for
 * links matching linkPattern. Such pages carry no publish dates, so publishedAt
 * is the discovery time. The pipeline baselines a listing feed's first crawl so
 * pre-existing posts never ingest as fresh news, and enrichListingPages fills
 * real titles and excerpts from each post page.
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

/** www and trailing dots are noise when matching a link against a known source. */
export function normalizeHost(raw: string): string {
  return raw.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

/**
 * Best-effort feed discovery for a bare domain: the Discourse API first, then
 * the homepage's rel=alternate link, then the well-known paths (Substack and
 * Medium use /feed, Ghost uses /rss/). Whatever is found is fetched and parsed
 * before it is returned, so a hit is a working feed and not a guess. Null means
 * the domain needs a human: no feed, or a listing scrape.
 */
export async function discoverFeed(
  host: string,
  timeoutMs: number
): Promise<{ url: string; type: "rss" | "discourse"; title?: string } | null> {
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

  for (const p of ["/feed", "/rss/", "/feed.xml", "/rss.xml", "/atom.xml", "/index.xml"]) {
    const found = await verify(base + p);
    if (found) return found;
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** og:title, og:description, and article:published_time from an article page. */
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

/**
 * Discourse list endpoints carry no post bodies, so items from those feeds
 * arrive title only. Backfill excerpts and engagement for a small batch by
 * fetching each topic's own JSON endpoint. Best-effort: a failed fetch leaves
 * the item title only, which is still usable.
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

/** All post-dedupe candidate enrichment. Runs before the LLM sees the batch. */
export async function enrichNewItems(items: CandidateItem[], feeds: FeedConfig[], timeoutMs: number): Promise<void> {
  await Promise.all([
    enrichDiscourseExcerpts(items, feeds, timeoutMs),
    enrichListingPages(items, feeds, timeoutMs),
  ]);
}

export async function fetchFeed(feed: FeedConfig, cfg: EngineConfig["ingest"]): Promise<FeedFetchResult> {
  try {
    let items: CandidateItem[];
    switch (feed.type) {
      case "discourse":
        items = await fetchDiscourse(feed, cfg.feedTimeoutMs);
        break;
      case "listing":
        items = await fetchListing(feed, cfg.feedTimeoutMs);
        break;
      default:
        items = await fetchRss(feed, cfg.feedTimeoutMs);
    }
    // Do not backfill history: only items fresh enough to be news.
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

export async function fetchAllFeeds(feeds: FeedConfig[], cfg: EngineConfig["ingest"]): Promise<FeedFetchResult[]> {
  return Promise.all(feeds.map((f) => fetchFeed(f, cfg)));
}

export function updateFeedHealth(state: EngineState, results: FeedFetchResult[], newItemSourceIds: Set<string>): void {
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
