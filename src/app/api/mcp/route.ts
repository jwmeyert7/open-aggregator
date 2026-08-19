import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { loadSiteConfig, navSections, siteUrl } from "@/lib/config";
import { adaptiveRanking, leadLink, liveClusters, rankClusters, sectionStories, topStories } from "@/lib/rank";
import { siteIdentity } from "@/lib/site";
import { loadDailyDigest, loadState } from "@/lib/state";
import type { Cluster } from "@/lib/types";

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
    ...(c.opinion ? { opinion: true } : {}),
    updatedAt: c.updatedAt,
    permalink: `${base}/story/${c.slug}`,
    leadUrl: lead?.url,
    sources: c.links.slice(0, MAX_SOURCES_PER_STORY).map((l) => ({
      source: l.sourceName,
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
          `Search the live ${id.siteName} stories by keyword. Matches headlines, explainers, editor keywords, and the titles of the underlying source links. Results come back in current rank order. When presenting a story to the user, link its permalink.`,
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
            c.links.some((l) => l.title.toLowerCase().includes(q))
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
      "get_daily_digest",
      {
        title: "Get daily digest",
        description:
          "One UTC day's frozen edition: the day's top stories plus an editor-written day-in-review paragraph. Omit the date for the most recent edition. Editions freeze shortly after midnight UTC, so today's edition usually does not exist yet and the live view is get_top_stories. When presenting a story to the user, link its permalink.",
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
        const target = date ?? available[0];
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
          ...(digest.summary ? { dayInReview: digest.summary } : {}),
          stories: digest.clusters.map((c, i) => serializeCluster(c, i + 1, base)),
        });
      }
    );
  },
  { serverInfo: { name: siteIdentity().siteName.toLowerCase().replace(/\s+/g, "-"), version: "1.0.0" } }
);

export { handler as GET, handler as POST };
