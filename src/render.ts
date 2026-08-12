import fs from "node:fs";
import path from "node:path";
import { loadEngineConfig } from "./config";
import { leadLink, sectionStories, topStories } from "./rank";
import { loadState } from "./state";
import type { Cluster, EngineConfig } from "./types";
import { escapeHtml, timeAgo } from "./util";

/** One source link under a story: source name plus the article title, linking out. */
function renderLink(link: Cluster["links"][number]): string {
  return `<li><a href="${escapeHtml(link.url)}" rel="noopener noreferrer">${escapeHtml(link.title)}</a> <span class="src">${escapeHtml(
    link.sourceName
  )}</span></li>`;
}

function renderCluster(cluster: Cluster): string {
  const lead = leadLink(cluster);
  const links = [...cluster.links].sort((a, b) => a.tier - b.tier || b.weight - a.weight);
  return `
    <article class="story">
      <h3 class="headline"><a href="${escapeHtml(lead.url)}" rel="noopener noreferrer">${escapeHtml(cluster.headline)}</a></h3>
      ${cluster.explainer ? `<p class="explainer">${escapeHtml(cluster.explainer)}</p>` : ""}
      <ul class="links">${links.map(renderLink).join("")}</ul>
      <p class="meta">${links.length} source${links.length === 1 ? "" : "s"} · updated ${escapeHtml(timeAgo(cluster.updatedAt))}</p>
    </article>`;
}

function renderSection(title: string, description: string, stories: Cluster[]): string {
  if (stories.length === 0) return "";
  return `
    <section class="block">
      <header class="block-head">
        <h2>${escapeHtml(title)}</h2>
        <p class="block-desc">${escapeHtml(description)}</p>
      </header>
      ${stories.map(renderCluster).join("")}
    </section>`;
}

const STYLE = `
  :root {
    --bg: #ffffff; --fg: #1a1a1a; --muted: #666666; --line: #e5e5e5;
    --link: #0b5cad; --accent: #0b5cad; --card: #fafafa;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14161a; --fg: #e8e8e8; --muted: #9aa0a6; --line: #2a2d33;
      --link: #6db3f2; --accent: #6db3f2; --card: #1b1e24;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .wrap { max-width: 760px; margin: 0 auto; padding: 2rem 1.1rem 4rem; }
  header.site { border-bottom: 2px solid var(--fg); padding-bottom: 0.8rem; margin-bottom: 1.6rem; }
  header.site h1 { margin: 0; font-size: 1.9rem; letter-spacing: -0.02em; }
  header.site .tagline { margin: 0.3rem 0 0; color: var(--muted); font-size: 0.95rem; }
  .block { margin: 2.4rem 0; }
  .block-head { border-bottom: 1px solid var(--line); margin-bottom: 1rem; }
  .block-head h2 {
    margin: 0; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent);
  }
  .block-desc { margin: 0.2rem 0 0.7rem; color: var(--muted); font-size: 0.85rem; }
  .story { padding: 0.9rem 0; border-bottom: 1px solid var(--line); }
  .headline { margin: 0 0 0.35rem; font-size: 1.16rem; line-height: 1.35; }
  .headline a { color: var(--fg); text-decoration: none; }
  .headline a:hover { color: var(--link); }
  .explainer { margin: 0 0 0.55rem; color: var(--fg); }
  ul.links { margin: 0.2rem 0 0.4rem; padding: 0; list-style: none; }
  ul.links li { font-size: 0.9rem; padding: 0.12rem 0; }
  ul.links a { color: var(--link); text-decoration: none; }
  ul.links a:hover { text-decoration: underline; }
  .src { color: var(--muted); font-size: 0.8rem; }
  .meta { margin: 0.35rem 0 0; color: var(--muted); font-size: 0.78rem; }
  .empty { color: var(--muted); font-style: italic; padding: 2rem 0; }
  footer.site { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--line); color: var(--muted); font-size: 0.8rem; }
  footer.site a { color: var(--link); }
`;

export function renderHtml(cfg: EngineConfig, state = loadState()): string {
  const now = new Date();
  const top = topStories(state, cfg.ranking, now);

  const sections = cfg.sections
    .map((s) => renderSection(s.title, s.description, sectionStories(state, s.id, cfg.ranking, now)))
    .join("");

  const topBlock =
    top.length > 0
      ? `<section class="block"><header class="block-head"><h2>Top Stories</h2></header>${top
          .map(renderCluster)
          .join("")}</section>`
      : "";

  const anyContent = top.length > 0 || sections.length > 0;
  const body = anyContent
    ? topBlock + sections
    : `<p class="empty">No stories yet. Run the pipeline with feeds configured and an LLM key set, then render again.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Aggregator Front Page</title>
  <style>${STYLE}</style>
</head>
<body>
  <div class="wrap">
    <header class="site">
      <h1>Aggregator</h1>
      <p class="tagline">A ranked front page built from handpicked feeds. Updated ${escapeHtml(timeAgo(state.updatedAt))}.</p>
    </header>
    ${body}
    <footer class="site">
      Generated by <a href="https://github.com/" rel="noopener noreferrer">open-aggregator</a>. Static page, no tracking.
    </footer>
  </div>
</body>
</html>`;
}

/** Render the current state to out/index.html and return the path written. */
export function renderToFile(): string {
  const cfg = loadEngineConfig();
  const state = loadState();
  const html = renderHtml(cfg, state);
  const outDir = path.join(process.cwd(), "out");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "index.html");
  fs.writeFileSync(outFile, html);
  return outFile;
}
