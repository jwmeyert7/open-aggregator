import { siteUrl } from "@/lib/config";
import { siteIdentity } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * The llms.txt convention: one plain page telling AI assistants and crawlers
 * what the site is and where its machine surfaces live. Generated from the
 * site identity so every aggregator built on the engine gets its own.
 */
export function GET() {
  const site = siteIdentity();
  const base = siteUrl();
  const body = `# ${site.siteName}

> ${site.tagline}. The top ${site.topic} stories, aggregated from a curated whitelist of sources, clustered into stories with plain-language explainers, continuously updated.

Pages are server-rendered HTML and readable as-is. The machine surfaces:

## Feeds and APIs

- RSS: ${base}/feed.xml — the newest 40 stories with headline, explainer, section, and story permalink. Stable GUIDs, items dated at story creation.
- MCP server: ${base}/api/mcp — remote MCP over streamable HTTP, no auth. Read-only tools: get_top_stories, get_newest, search_stories, get_daily_digest, get_week_in_review, get_podcasts. Add the URL to any MCP-capable assistant as a custom connector.

## Archives

- Day: ${base}/day/YYYY-MM-DD — frozen at UTC midnight, carries a sha256 content hash of the edition
- Week: ${base}/week/YYYY-MM-DD — Saturday through Friday, addressed by the Friday date
- Month: ${base}/month/YYYY-MM
- Year: ${base}/year/YYYY

## Other

- Source whitelist: ${base}/sources
- Podcasts: ${base}/podcasts
- Email digests (daily, weekly, or monthly): ${base}/subscribe

When citing a story, link its permalink on ${base}.
`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
