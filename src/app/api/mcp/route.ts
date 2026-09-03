import { createMcpHandler } from "mcp-handler";
import { after } from "next/server";
import { z } from "zod";
import { loadSiteConfig, navSections, siteUrl } from "@/lib/config";
import { recordMcpBody, recordMcpHtmlView } from "@/lib/metrics";
import { adaptiveRanking, byPublished, episodeStories, itemDisplayTitle, leadLink, liveClusters, rankClusters, rankMedia, sectionStories, topStories, weekInReview } from "@/lib/rank";
import { siteIdentity } from "@/lib/site";
import { loadDailyDigest, loadState } from "@/lib/state";
import type { Cluster } from "@/lib/types";
import { urlMatches } from "@/lib/util";

export const dynamic = "force-dynamic";

/**
 * Remote MCP endpoint (streamable HTTP, stateless). Read-only tools over the
 * same ranked state the front page renders, so an MCP client's "top stories"
 * always matches the live site at that moment. No LLM runs here.
 */

const MAX_COUNT = 30;
const MAX_SOURCES_PER_STORY = 10;

function serializeCluster(c: Cluster, rank: number, base: string) {
  const lead = leadLink(c);
  return {
    rank,
    headline: c.headline,
    explainer: c.explainer,
    section: c.section,
    ...(c.alsoIn ? { alsoIn: c.alsoIn } : {}),
    ...(c.mentions && c.mentions.length > 0
      ? { discussedOn: c.mentions.map((m) => ({ show: m.show, title: m.title, ...(m.at !== undefined ? { at: m.at } : {}), playOnSite: `${base}/podcasts?play=${m.mediaId}${m.at !== undefined ? `&t=${m.at}` : ""}` })) }
      : {}),
    ...(c.opinion ? { opinion: true } : {}),
    updatedAt: c.updatedAt,
    permalink: `${base}/story/${c.slug}`,
    leadUrl: lead?.url,
    sources: c.links.slice(0, MAX_SOURCES_PER_STORY).map((l) => ({
      source: l.sourceName,
      ...(l.byline ? { byline: l.byline } : {}),
      title: l.title,
      url: l.url,
      publishedAt: l.publishedAt,
    })),
    ...(c.links.length > MAX_SOURCES_PER_STORY ? { moreSources: c.links.length - MAX_SOURCES_PER_STORY } : {}),
  };
}

function asText(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

const countSchema = z.number().int().min(1).max(MAX_COUNT).optional();

const handler = createMcpHandler(
  (server) => {
    const id = siteIdentity();
    const sections = navSections();
    const sectionList = sections.map((s) => `${s.id} (${s.description})`).join(", ");

    server.registerTool(
      "get_top_stories",
      {
        title: "Get top stories",
        description:
          `The current top stories about ${id.topic} from ${id.siteName}, ranked exactly as the live front page ranks them.` +
          (sections.length > 0 ? ` Optionally filter to one section: ${sectionList}.` : "") +
          " When presenting a story to the user, link its permalink.",
        annotations: { readOnlyHint: true },
        inputSchema: z.object({
          section: z.string().optional(),
          count: countSchema,
        }),
      },
      async ({ section, count }) => {
        if (section && !sections.some((s) => s.id === section)) {
          return asText({ error: `Unknown section "${section}".`, sections: sections.map((s) => s.id) });
        }
        const state = await loadState();
        const cfg = loadSiteConfig();
        const ranking = adaptiveRanking(state, cfg.ranking);
        const stories = section ? sectionStories(state, section, ranking) : topStories(state, ranking);
        const base = siteUrl();
        return asText({
          site: base,
          updatedAt: state.updatedAt,
          ...(section ? { section } : {}),
          stories: stories.slice(0, count ?? 10).map((c, i) => serializeCluster(c, i + 1, base)),
        });
      }
    );

    server.registerTool(
      "search_stories",
      {
        title: "Search stories",
        description:
          `Search the live ${id.siteName} stories by keyword, writer, or link. Matches headlines, explainers, editor keywords, and the titles, bylines, and URLs of the underlying source links, so pasting an article URL finds the story that covers it. Results come back in current rank order. When presenting a story to the user, link its permalink.`,
        annotations: { readOnlyHint: true },
        inputSchema: z.object({
          query: z.string().min(2).max(200),
          count: countSchema,
        }),
      },
      async ({ query, count }) => {
        const state = await loadState();
        const cfg = loadSiteConfig();
        const ranking = adaptiveRanking(state, cfg.ranking);
        const q = query.toLowerCase();
        const matches = liveClusters(state).filter(
          (c) =>
            c.headline.toLowerCase().includes(q) ||
            c.explainer.toLowerCase().includes(q) ||
            c.keywords.some((k) => k.toLowerCase().includes(q)) ||
            c.links.some((l) => l.title.toLowerCase().includes(q) || Boolean(l.byline?.toLowerCase().includes(q)) || urlMatches(l.url, query))
        );
        const base = siteUrl();
        return asText({
          site: base,
          query,
          matched: matches.length,
          stories: rankClusters(matches, ranking)
            .slice(0, count ?? 10)
            .map((c, i) => serializeCluster(c, i + 1, base)),
        });
      }
    );

    server.registerTool(
      "get_newest",
      {
        title: "Get newest items",
        description:
          "The newest accepted items across all whitelisted sources, one entry per article, newest first by publish time. This is the raw unranked stream: use it for questions like what just came in or has anything happened in the last hour. For what matters most, use get_top_stories instead.",
        annotations: { readOnlyHint: true },
        inputSchema: z.object({
          count: countSchema,
        }),
      },
      async ({ count }) => {
        const state = await loadState();
        const base = siteUrl();
        return asText({
          site: base,
          updatedAt: state.updatedAt,
          items: byPublished(state.items)
            .slice(0, count ?? 10)
            .map((item) => {
              const c = item.clusterId ? state.clusters[item.clusterId] : undefined;
              return {
                title: itemDisplayTitle(state, item),
                url: item.url,
                source: item.sourceName,
                publishedAt: item.publishedAt,
                ...(c && !c.killed ? { storyPermalink: `${base}/story/${c.slug}` } : {}),
              };
            }),
        });
      }
    );

    server.registerTool(
      "get_podcasts",
      {
        title: "Get podcasts shelf",
        description:
          `The newest videos and podcast episodes about ${id.topic} from whitelisted shows, newest first: the site's Podcasts shelf. Episodes from broader shows appear only when they are substantially about ${id.topic}.` +
          (sections.length > 0 ? ` Each carries a section label (${sections.map((s) => s.id).join(", ")}); filter with section.` : "") +
          " Titles are the shows' own, not rewritten. Use this for 'what should I watch or listen to' questions; for the written news use get_top_stories or get_newest.",
        annotations: { readOnlyHint: true },
        inputSchema: z.object({
          count: countSchema,
          section: z.string().optional(),
          order: z.enum(["newest", "top"]).optional().describe("newest (default) or top: ranked by view velocity, show tier, and ties to the current top stories"),
        }),
      },
      async ({ count, section, order }) => {
        if (section && !sections.some((s) => s.id === section)) {
          return asText({ error: `Unknown section "${section}".`, sections: sections.map((s) => s.id) });
        }
        const state = await loadState();
        const base = siteUrl();
        const covered = episodeStories(state);
        const pool = (state.mediaItems ?? []).filter((m) => !m.hidden && (!section || m.roundup || m.section === section));
        return asText({
          site: base,
          updatedAt: state.updatedAt,
          shelf: `${base}/podcasts`,
          order: order ?? "newest",
          episodes: (order === "top" ? rankMedia(pool, state, loadSiteConfig().ranking) : pool)
            .slice(0, count ?? 10)
            .map((m) => ({
              title: m.displayTitle ?? m.title,
              ...(m.displayTitle ? { showsTitle: m.title } : {}),
              url: m.url,
              show: m.sourceName,
              kind: m.kind,
              ...(m.section ? { section: m.section } : {}),
              publishedAt: m.publishedAt,
              ...(m.durationSec ? { durationSec: m.durationSec } : {}),
              ...(m.audioUrl ? { audioUrl: m.audioUrl } : {}),
              ...(m.videoUrl ? { videoUrl: m.videoUrl } : {}),
              ...((): object => {
                const c = covered.get(m.id) ?? [];
                return c.length > 0
                  ? { covers: c.slice(0, 8).map((x) => ({ headline: x.headline, storyPermalink: `${base}/story/${x.slug}`, ...(x.at !== undefined ? { at: x.at } : {}) })) }
                  : {};
              })(),
              playOnSite: `${base}/podcasts?play=${m.id}`,
            })),
        });
      }
    );

    server.registerTool(
      "get_week_in_review",
      {
        title: "Get week in review",
        description:
          "The week's biggest stories, ranked by editorial importance and total coverage rather than freshness. Periods: last_7_days is a rolling window ending now (the default), week_so_far covers the current Saturday-to-Friday week up to now, and last_week is the most recent completed Saturday-to-Friday week. A user asking about 'this week' on a Saturday or Sunday usually means the week just completed, so prefer last_week then. Every response states the exact date range it covered. When presenting a story to the user, link its permalink.",
        annotations: { readOnlyHint: true },
        inputSchema: z.object({
          period: z.enum(["last_7_days", "week_so_far", "last_week"]).optional(),
          count: countSchema,
        }),
      },
      async ({ period, count }) => {
        const state = await loadState();
        const cfg = loadSiteConfig();
        const ranking = adaptiveRanking(state, cfg.ranking);
        const now = new Date();
        const daysSinceSat = (now.getUTCDay() + 1) % 7;
        const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceSat));
        const window =
          period === "week_so_far"
            ? { start: weekStart, end: now }
            : period === "last_week"
              ? { start: new Date(weekStart.getTime() - 7 * 24 * 60 * 60000), end: weekStart }
              : undefined;
        const week = weekInReview(state, ranking, new Set(), now, window);
        const base = siteUrl();
        return asText({
          site: base,
          updatedAt: state.updatedAt,
          period: period ?? "last_7_days",
          range: window
            ? { from: window.start.toISOString(), to: window.end.toISOString() }
            : { from: new Date(now.getTime() - 7 * 24 * 60 * 60000).toISOString(), to: now.toISOString() },
          stories: week.slice(0, count ?? week.length).map((c, i) => serializeCluster(c, i + 1, base)),
        });
      }
    );

    server.registerTool(
      "get_daily_digest",
      {
        title: "Get daily digest",
        description:
          "One UTC day's edition: the day's top stories plus an editor-written day-in-review paragraph. Omit the date for the most recent frozen edition. Editions freeze shortly after midnight UTC; today's date returns the still-in-progress edition, marked inProgress. When presenting a story to the user, link its permalink.",
        annotations: { readOnlyHint: true },
        inputSchema: z.object({
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
            .optional(),
        }),
      },
      async ({ date }) => {
        const state = await loadState();
        const available = state.dailyDigestDates ?? [];
        // the no-date default is the newest FROZEN edition, so callers asking
        // for "the daily digest" never get the half-built current day
        const today = new Date().toISOString().slice(0, 10);
        const target = date ?? available.find((d) => d !== today);
        if (!target) return asText({ error: "No daily editions exist yet." });
        const digest = await loadDailyDigest(target);
        if (!digest) {
          return asText({
            error: `No edition for ${target}.`,
            availableDates: available.slice(0, 30),
          });
        }
        const base = siteUrl();
        return asText({
          site: base,
          date: digest.date,
          permalink: `${base}/day/${digest.date}`,
          ...(digest.inProgress ? { inProgress: true, note: "This day is still in progress and updates all day." } : {}),
          ...(digest.summary ? { dayInReview: digest.summary } : {}),
          stories: digest.clusters.map((c, i) => serializeCluster(c, i + 1, base)),
        });
      }
    );
  },
  { serverInfo: { name: siteIdentity().siteName.toLowerCase().replace(/\s+/g, "-"), version: "1.0.0" } }
);

/**
 * A person clicking the MCP link in a browser gets a one-paragraph explainer
 * instead of a protocol error. Real MCP clients speak JSON-RPC over POST, or
 * GET with an event-stream Accept header, and both pass straight through.
 */
function browserExplainer(): Response {
  const site = siteIdentity();
  const base = siteUrl();
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${site.siteName} MCP server</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{background:#15171b;color:#e8e8e4;font-family:system-ui,sans-serif;max-width:640px;margin:80px auto;padding:0 20px;line-height:1.6}a{color:#8b8ff0}code{background:#23262f;padding:2px 6px;border-radius:4px}h1{font-size:1.4rem}p{color:#b8bcc4}</style>
</head><body>
<h1>This is the ${site.siteName} MCP server</h1>
<p>It speaks a machine protocol, so there is nothing to see in a browser. Add the URL
<code>${base}/api/mcp</code> to Claude, ChatGPT, or any MCP-capable assistant as a custom connector and it
gains read-only tools: top stories, the newest items, search, daily digests, the week in review, and
podcasts, all ranked exactly as the live site ranks them.</p>
<p>Prefer a feed? There is <a href="${base}/feed.xml">RSS</a>. Prefer a page for humans? That is
<a href="${base}">${site.domain}</a>.</p>
</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

async function GET(req: Request) {
  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("text/html") && !accept.includes("text/event-stream")) {
    after(() => recordMcpHtmlView());
    return browserExplainer();
  }
  return handler(req);
}

// the clone is taken before handler(req) consumes the body; parsing happens
// post-response inside after(), so counting costs the caller nothing
async function POST(req: Request) {
  const clone = req.clone();
  after(async () => {
    try {
      await recordMcpBody(await clone.json());
    } catch {}
  });
  return handler(req);
}

export { GET, POST };
