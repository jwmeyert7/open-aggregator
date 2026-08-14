import fs from "node:fs";
import path from "node:path";
import { loadEngineConfig } from "./config";
import { leadLink, sectionStories, topStories } from "./rank";
import { loadState } from "./state";
import type { Cluster, EngineConfig, EngineState } from "./types";
import { escapeHtml, timeAgo } from "./util";

const REPO_URL = "https://github.com/jwmeyert7/open-aggregator";
const NEWEST_COUNT = 15;

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

/** The Newest rail: the most recently published items across all feeds, raw and unclustered. */
function renderNewest(state: EngineState): string {
  const items = [...state.items]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, NEWEST_COUNT);
  if (items.length === 0) return "";
  const lis = items
    .map(
      (i) =>
        `<li><a href="${escapeHtml(i.url)}" rel="noopener noreferrer">${escapeHtml(i.title)}</a><span class="org">${escapeHtml(
          i.sourceName
        )} · ${escapeHtml(timeAgo(i.publishedAt))}</span></li>`
    )
    .join("");
  return `<aside class="rail"><h2>Newest</h2><ul>${lis}</ul></aside>`;
}

const STYLE = `
  :root {
    --bg: #ffffff; --fg: #1a1a1a; --muted: #666666; --line: #e5e5e5;
    --link: #0b5cad; --accent: #0b5cad; --card: #fafafa;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #14161a; --fg: #e8e8e8; --muted: #9aa0a6; --line: #2a2d33;
      --link: #6db3f2; --accent: #6db3f2; --card: #1b1e24;
    }
  }
  :root[data-theme="dark"] {
    --bg: #14161a; --fg: #e8e8e8; --muted: #9aa0a6; --line: #2a2d33;
    --link: #6db3f2; --accent: #6db3f2; --card: #1b1e24;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 0 1.1rem 4rem; }
  header.site {
    position: sticky; top: 0; z-index: 10; background: var(--bg);
    border-bottom: 2px solid var(--fg); padding: 0.7rem 0; margin-bottom: 1.6rem;
    display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap;
  }
  header.site h1 { margin: 0; font-size: 1.5rem; letter-spacing: -0.02em; }
  header.site .tagline { margin: 0; color: var(--muted); font-size: 0.85rem; flex: 1 1 auto; }
  .tools { display: flex; align-items: center; gap: 0.5rem; }
  #search {
    background: var(--card); color: var(--fg); border: 1px solid var(--line);
    border-radius: 6px; padding: 0.3rem 0.6rem; font-size: 0.85rem; width: 11rem;
  }
  #theme {
    background: var(--card); color: var(--fg); border: 1px solid var(--line);
    border-radius: 6px; padding: 0.3rem 0.55rem; font-size: 0.85rem; cursor: pointer;
  }
  .cols { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 2.2rem; }
  @media (max-width: 820px) { .cols { grid-template-columns: minmax(0, 1fr); } }
  .block { margin: 0 0 2.4rem; }
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
  .rail h2 {
    margin: 0 0 0.6rem; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent);
    border-bottom: 1px solid var(--line); padding-bottom: 0.35rem;
  }
  .rail ul { margin: 0; padding: 0; list-style: none; }
  .rail li { padding: 0.4rem 0; border-bottom: 1px solid var(--line); font-size: 0.88rem; line-height: 1.4; }
  .rail a { color: var(--fg); text-decoration: none; display: block; }
  .rail a:hover { color: var(--link); }
  .rail .org { color: var(--muted); font-size: 0.76rem; display: block; margin-top: 0.1rem; }
  .hidden { display: none; }
  footer.site { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--line); color: var(--muted); font-size: 0.8rem; }
  footer.site a { color: var(--link); }
`;

/**
 * Client-side niceties for a static page: a text filter over stories and rail
 * items, and a light/dark toggle persisted in localStorage. Auto (no stored
 * choice) follows the system preference via the media query in the CSS.
 */
const SCRIPT = `
  (function () {
    var root = document.documentElement;
    var stored = null;
    try { stored = localStorage.getItem("theme"); } catch (e) {}
    if (stored === "light" || stored === "dark") root.dataset.theme = stored;
    var btn = document.getElementById("theme");
    function label() {
      btn.textContent = root.dataset.theme === "dark" ? "light" : root.dataset.theme === "light" ? "auto" : "dark";
    }
    label();
    btn.addEventListener("click", function () {
      var next = root.dataset.theme === "dark" ? "light" : root.dataset.theme === "light" ? "" : "dark";
      if (next) { root.dataset.theme = next; } else { delete root.dataset.theme; }
      try { next ? localStorage.setItem("theme", next) : localStorage.removeItem("theme"); } catch (e) {}
      label();
    });

    var search = document.getElementById("search");
    search.addEventListener("input", function () {
      var q = search.value.trim().toLowerCase();
      document.querySelectorAll(".story, .rail li").forEach(function (el) {
        el.classList.toggle("hidden", q !== "" && el.textContent.toLowerCase().indexOf(q) === -1);
      });
      document.querySelectorAll(".block").forEach(function (block) {
        var visible = block.querySelectorAll(".story:not(.hidden)").length;
        block.classList.toggle("hidden", q !== "" && visible === 0);
      });
    });
  })();
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
      <div class="tools">
        <input id="search" type="search" placeholder="Filter stories" aria-label="Filter stories">
        <button id="theme" type="button" aria-label="Toggle color theme">dark</button>
      </div>
    </header>
    <div class="cols">
      <main>${body}</main>
      ${renderNewest(state)}
    </div>
    <footer class="site">
      Generated by <a href="${REPO_URL}" rel="noopener noreferrer">open-aggregator</a>. Static page, no tracking.
    </footer>
  </div>
  <script>${SCRIPT}</script>
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
