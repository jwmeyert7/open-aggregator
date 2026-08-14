import fs from "node:fs";
import path from "node:path";
import { loadEngineConfig } from "./config";
import { leadLink, liveClusters, rankClusters, sectionStories, topStories } from "./rank";
import { loadState } from "./state";
import type { Cluster, EngineConfig, EngineState } from "./types";
import { escapeHtml, timeAgo } from "./util";

const REPO_URL = "https://github.com/jwmeyert7/open-aggregator";
const NEWEST_COUNT = 15;
const STREAM_COUNT = 200;
const ARCHIVE_DAYS = 30;

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

function renderSection(id: string, title: string, description: string, stories: Cluster[]): string {
  if (stories.length === 0) return "";
  return `
    <section class="block" id="${escapeHtml(id)}">
      <header class="block-head">
        <h2><a href="${escapeHtml(id)}.html">${escapeHtml(title)}</a></h2>
        <p class="block-desc">${escapeHtml(description)}</p>
      </header>
      ${stories.map(renderCluster).join("")}
    </section>`;
}

/** Age bucket for the freshness hue: warm when very fresh, faded once a day old. */
function ageClass(publishedAt: string, now: Date): string {
  const hours = (now.getTime() - new Date(publishedAt).getTime()) / 3600000;
  if (hours < 2) return "age-fresh";
  if (hours >= 24) return "age-old";
  return "";
}

function renderItemLi(item: EngineState["items"][number], now: Date): string {
  return `<li><a href="${escapeHtml(item.url)}" rel="noopener noreferrer">${escapeHtml(item.title)}</a><span class="org">${escapeHtml(
    item.sourceName
  )} · <span class="age ${ageClass(item.publishedAt, now)}">${escapeHtml(timeAgo(item.publishedAt))}</span></span></li>`;
}

/** The Newest rail: the most recently published items across all feeds, raw and unclustered. */
function renderNewest(state: EngineState, now: Date): string {
  const items = [...state.items]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, NEWEST_COUNT);
  if (items.length === 0) return "";
  return `<aside class="rail"><h2>Newest</h2><ul>${items.map((i) => renderItemLi(i, now)).join("")}</ul></aside>`;
}

const STYLE = `
  :root {
    --bg: #ffffff; --fg: #1a1a1a; --muted: #666666; --line: #e5e5e5;
    --link: #0b5cad; --accent: #0b5cad; --card: #fafafa;
    --fresh: #b3661f; --faded: #a3a3a3;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #14161a; --fg: #e8e8e8; --muted: #9aa0a6; --line: #2a2d33;
      --link: #6db3f2; --accent: #6db3f2; --card: #1b1e24;
      --fresh: #e8a45c; --faded: #6b7075;
    }
  }
  :root[data-theme="dark"] {
    --bg: #14161a; --fg: #e8e8e8; --muted: #9aa0a6; --line: #2a2d33;
    --link: #6db3f2; --accent: #6db3f2; --card: #1b1e24;
    --fresh: #e8a45c; --faded: #6b7075;
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
  header.site h1 a { color: var(--fg); text-decoration: none; }
  nav.mainnav {
    display: flex; gap: 1.2rem; font-size: 0.85rem; padding: 0.55rem 0; margin-bottom: 1.6rem;
    border-bottom: 1px solid var(--line); text-transform: uppercase; letter-spacing: 0.06em;
  }
  nav.mainnav a { color: var(--muted); text-decoration: none; }
  nav.mainnav a:hover, nav.mainnav a.here { color: var(--accent); }
  header.site .tagline { margin: 0; color: var(--muted); font-size: 0.85rem; flex: 1 1 auto; }
  .tools { display: flex; align-items: center; gap: 0.5rem; }
  #search {
    background: var(--card); color: var(--fg); border: 1px solid var(--line);
    border-radius: 6px; padding: 0.3rem 0.6rem; font-size: 0.85rem; width: 11rem;
  }
  #theme {
    background: var(--card); color: var(--fg); border: 1px solid var(--line);
    border-radius: 6px; padding: 0.3rem 0.55rem; font-size: 0.9rem; cursor: pointer; line-height: 1;
  }
  .cols { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 2.2rem; }
  @media (max-width: 820px) { .cols { grid-template-columns: minmax(0, 1fr); } }
  .block { margin: 0 0 2.4rem; scroll-margin-top: 4.5rem; }
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
  .rail h2, .stream h2 {
    margin: 0 0 0.6rem; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent);
    border-bottom: 1px solid var(--line); padding-bottom: 0.35rem;
  }
  .rail ul, .stream ul { margin: 0; padding: 0; list-style: none; }
  .rail li, .stream li { padding: 0.4rem 0; border-bottom: 1px solid var(--line); font-size: 0.88rem; line-height: 1.4; }
  .rail a, .stream a { color: var(--fg); text-decoration: none; display: block; }
  .rail a:hover, .stream a:hover { color: var(--link); }
  .rail .org, .stream .org { color: var(--muted); font-size: 0.76rem; display: block; margin-top: 0.1rem; }
  .stream { max-width: 680px; }
  .age-fresh { color: var(--fresh); }
  .age-old { color: var(--faded); }
  .days { margin: 2rem 0 0; color: var(--muted); font-size: 0.82rem; line-height: 2; }
  .days a { color: var(--link); text-decoration: none; margin-right: 0.6rem; }
  .archive-note { color: var(--muted); font-size: 0.85rem; margin: 0 0 1.4rem; }
  .section-lead { color: var(--muted); font-size: 0.85rem; margin: -0.7rem 0 0.9rem; }
  .hidden { display: none; }
  footer.site {
    margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--line); color: var(--muted); font-size: 0.8rem;
    display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;
  }
  footer.site a { color: var(--link); }
  .footer-links a { text-decoration: none; }
  .footer-pref { cursor: pointer; user-select: none; }
`;

/**
 * Client-side niceties for a static page: a text filter over stories and rail
 * items, a light/dark toggle persisted in localStorage that follows the system
 * preference until the user chooses, and the outbound-links-in-new-tab
 * preference. Auto (no stored choice) follows the media query in the CSS.
 */
const SCRIPT = `
  (function () {
    var root = document.documentElement;
    var stored = null;
    try { stored = localStorage.getItem("theme"); } catch (e) {}
    if (stored === "light" || stored === "dark") root.dataset.theme = stored;
    var btn = document.getElementById("theme");
    function current() {
      if (root.dataset.theme) return root.dataset.theme;
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    function label() {
      var dark = current() === "dark";
      btn.textContent = dark ? "\\u2600" : "\\u263E";
      btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
      btn.setAttribute("title", dark ? "Switch to light mode" : "Switch to dark mode");
    }
    label();
    btn.addEventListener("click", function () {
      var next = current() === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      try { localStorage.setItem("theme", next); } catch (e) {}
      label();
    });

    var pref = document.getElementById("newtab");
    var newtab = true;
    try {
      var savedPref = localStorage.getItem("newtab");
      newtab = savedPref !== null ? savedPref === "1" : !window.matchMedia("(pointer: coarse)").matches;
    } catch (e) {}
    pref.checked = newtab;
    pref.addEventListener("change", function () {
      newtab = pref.checked;
      try { localStorage.setItem("newtab", newtab ? "1" : "0"); } catch (e) {}
    });
    document.addEventListener("click", function (e) {
      if (!newtab) return;
      var anchor = e.target && e.target.closest ? e.target.closest("a") : null;
      if (!anchor || !anchor.href) return;
      try {
        if (new URL(anchor.href).origin !== window.location.origin) {
          anchor.target = "_blank";
          anchor.rel = anchor.rel ? anchor.rel + " noopener" : "noopener";
        }
      } catch (err) {}
    }, true);

    var clock = document.getElementById("clock");
    function tick() {
      var now = new Date();
      clock.textContent = " · " + now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) +
        " " + now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    }
    tick();
    setInterval(tick, 30000);

    var search = document.getElementById("search");
    search.addEventListener("input", function () {
      var q = search.value.trim().toLowerCase();
      document.querySelectorAll(".story, .rail li, .stream li").forEach(function (el) {
        el.classList.toggle("hidden", q !== "" && el.textContent.toLowerCase().indexOf(q) === -1);
      });
      document.querySelectorAll(".block").forEach(function (block) {
        var visible = block.querySelectorAll(".story:not(.hidden)").length;
        block.classList.toggle("hidden", q !== "" && visible === 0);
      });
    });
  })();
`;

/**
 * The shared page shell. prefix is the relative path back to the output root
 * ("" for root pages, "../" for day pages) so every page works from the
 * filesystem as well as any static host.
 */
function shell(opts: {
  title: string;
  content: string;
  prefix: string;
  sections: Array<{ id: string; title: string }>;
  active?: string;
}): string {
  const { title, content, prefix, sections, active } = opts;
  const nav = [
    `<a href="${prefix}index.html"${active === "top" ? ' class="here"' : ""}>Top stories</a>`,
    ...sections.map(
      (s) =>
        `<a href="${prefix}${escapeHtml(s.id)}.html"${active === s.id ? ' class="here"' : ""}>${escapeHtml(s.title)}</a>`
    ),
  ].join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${STYLE}</style>
</head>
<body>
  <div class="wrap">
    <header class="site">
      <h1><a href="${prefix}index.html">Open Aggregator</a></h1>
      <p class="tagline">A ranked front page built from handpicked feeds<span id="clock"></span></p>
      <div class="tools">
        <input id="search" type="search" placeholder="Search" aria-label="Search">
        <button id="theme" type="button" aria-label="Toggle color theme">☾</button>
      </div>
    </header>
    <nav class="mainnav">${nav}</nav>
    ${content}
    <footer class="site">
      <span>Built with <a href="${REPO_URL}" rel="noopener noreferrer">open-aggregator</a>.</span>
      <span class="footer-links"><a href="${prefix}stream.html">stream</a> · <a href="${prefix}archive.html">archive</a></span>
      <label class="footer-pref"><input id="newtab" type="checkbox"> open links in new tab</label>
    </footer>
  </div>
  <script>${SCRIPT}</script>
</body>
</html>`;
}

export function renderHtml(cfg: EngineConfig, state = loadState()): string {
  const now = new Date();
  // Top Stories mixes every section. When nothing clears the score bar (the
  // keyless first run), the best-ranked clusters overall fill it instead so
  // the page never opens with an empty lead block.
  let top = topStories(state, cfg.ranking, now);
  if (top.length === 0) {
    top = rankClusters(liveClusters(state), cfg.ranking, now).slice(0, cfg.ranking.maxTopStories);
  }
  const topIds = new Set(top.map((c) => c.id));

  const sections = cfg.sections
    .map((s) =>
      renderSection(
        s.id,
        s.title,
        s.description,
        sectionStories(state, s.id, cfg.ranking, now).filter((c) => !topIds.has(c.id))
      )
    )
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

  return shell({
    title: "Open Aggregator",
    prefix: "",
    sections: cfg.sections,
    active: "top",
    content: `<div class="cols"><main>${body}</main>${renderNewest(state, now)}</div>`,
  });
}

/** Every ingested item in reverse chronological order. */
export function renderStreamHtml(cfg: EngineConfig, state: EngineState): string {
  const now = new Date();
  const items = [...state.items].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, STREAM_COUNT);
  const list =
    items.length > 0
      ? `<ul>${items.map((i) => renderItemLi(i, now)).join("")}</ul>`
      : `<p class="empty">Nothing ingested yet.</p>`;
  return shell({
    title: "Stream · Open Aggregator",
    prefix: "",
    sections: cfg.sections,
    content: `<main class="stream"><h2>Stream</h2>${list}</main>`,
  });
}

/** One section's page: only that section's stories, with the Newest rail. */
export function renderSectionHtml(cfg: EngineConfig, state: EngineState, sectionId: string): string {
  const now = new Date();
  const section = cfg.sections.find((s) => s.id === sectionId)!;
  const stories = sectionStories(state, sectionId, cfg.ranking, now);
  const body =
    stories.length > 0
      ? `<section class="block"><p class="section-lead">${escapeHtml(section.description)}</p>${stories
          .map(renderCluster)
          .join("")}</section>`
      : `<p class="empty">No ${escapeHtml(section.title)} stories yet.</p>`;
  return shell({
    title: `${section.title} · Open Aggregator`,
    prefix: "",
    sections: cfg.sections,
    active: sectionId,
    content: `<div class="cols"><main>${body}</main>${renderNewest(state, now)}</div>`,
  });
}

/** The archive index: one link per covered UTC day, newest first. */
export function renderArchiveHtml(cfg: EngineConfig, state: EngineState): string {
  const days = archiveDays(state)
    .map((d) => `<a href="day/${d}.html">${d}</a>`)
    .join("");
  return shell({
    title: "Archive · Open Aggregator",
    prefix: "",
    sections: cfg.sections,
    content: `<main class="stream"><h2>Daily archive</h2>${
      days ? `<p class="days">${days}</p>` : `<p class="empty">No covered days yet.</p>`
    }</main>`,
  });
}

/** UTC days that saw coverage, newest first, capped. */
function archiveDays(state: EngineState): string[] {
  const days = new Set<string>();
  for (const c of liveClusters(state)) for (const l of c.links) days.add(l.addedAt.slice(0, 10));
  return [...days].sort().reverse().slice(0, ARCHIVE_DAYS);
}

/** One UTC day's stories: every cluster that gained coverage that day, importance first. */
export function renderDayHtml(cfg: EngineConfig, state: EngineState, day: string): string {
  const clusters = liveClusters(state)
    .filter((c) => c.links.some((l) => l.addedAt.slice(0, 10) === day))
    .sort((a, b) => b.importance - a.importance || b.updatedAt.localeCompare(a.updatedAt));
  const body =
    clusters.length > 0
      ? clusters.map(renderCluster).join("")
      : `<p class="empty">No stories recorded for this day.</p>`;
  return shell({
    title: `${day} · Open Aggregator`,
    prefix: "../",
    sections: cfg.sections,
    content: `<main><p class="archive-note">Daily archive for ${escapeHtml(
      day
    )} UTC, regenerated from current data on every run.</p>${body}</main>`,
  });
}

/** Render the front page, the stream, and the daily archive to out/ and return the front page path. */
export function renderToFile(): string {
  const cfg = loadEngineConfig();
  const state = loadState();
  const outDir = path.join(process.cwd(), "out");
  fs.mkdirSync(path.join(outDir, "day"), { recursive: true });
  const outFile = path.join(outDir, "index.html");
  fs.writeFileSync(outFile, renderHtml(cfg, state));
  fs.writeFileSync(path.join(outDir, "stream.html"), renderStreamHtml(cfg, state));
  fs.writeFileSync(path.join(outDir, "archive.html"), renderArchiveHtml(cfg, state));
  for (const s of cfg.sections) {
    fs.writeFileSync(path.join(outDir, `${s.id}.html`), renderSectionHtml(cfg, state, s.id));
  }
  for (const day of archiveDays(state)) {
    fs.writeFileSync(path.join(outDir, "day", `${day}.html`), renderDayHtml(cfg, state, day));
  }
  return outFile;
}
