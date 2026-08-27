import fs from "node:fs";
import path from "node:path";
import { siteIdentity } from "./site";
import type { FeedConfig, SectionConfig, SiteConfig, SiteState } from "./types";
import { GENERAL_SECTION } from "./types";

const configDir = path.join(process.cwd(), "config");

/**
 * Real config wins; the tracked .example file is the fallback so a fresh
 * clone runs with zero setup. Your own feeds.json, sections.json, site.json,
 * and prompts/*.md are gitignored on purpose.
 */
function readWithFallback(...names: string[]): string {
  for (const name of names) {
    const full = path.join(configDir, name);
    if (fs.existsSync(full)) return fs.readFileSync(full, "utf8");
  }
  throw new Error(`Missing config file: ${names[0]} (and no ${names[names.length - 1]} fallback)`);
}

function readJson<T>(...names: string[]): T {
  return JSON.parse(readWithFallback(...names)) as T;
}

export function loadFeeds(): FeedConfig[] {
  return readJson<{ feeds: FeedConfig[] }>("feeds.json", "feeds.example.json").feeds;
}

/**
 * The sources the pipeline actually polls: config/feeds.json as the base
 * whitelist, minus admin-disabled feeds, plus admin-added ones.
 */
export function effectiveFeeds(state: SiteState): FeedConfig[] {
  const o = state.feedOverrides ?? { custom: [], disabled: [] };
  const disabled = new Set(o.disabled);
  return [...loadFeeds(), ...(o.custom ?? [])]
    .filter((f) => !disabled.has(f.id))
    .map((f) => ({ ...f, ...(o.edits?.[f.id] ?? {}) }));
}

export function loadSiteConfig(): SiteConfig {
  return readJson<SiteConfig>("sections.json", "sections.example.json");
}

/** The configured nav sections (never includes the built-in "general"). */
export function navSections(): SectionConfig[] {
  return loadSiteConfig().sections;
}

/** Every valid cluster section id: the configured sections plus "general". */
export function sectionIds(): string[] {
  return [...navSections().map((s) => s.id), GENERAL_SECTION];
}

/**
 * The Polymarket markets the pipeline actually polls: config/sections.json as
 * the base list, minus admin-disabled markets, plus admin-added ones.
 */
export function effectiveMarkets(state: SiteState): NonNullable<SiteConfig["polymarket"]>["markets"] {
  const base = loadSiteConfig().polymarket?.markets ?? [];
  const o = state.marketOverrides ?? { custom: [], disabled: [] };
  const disabled = new Set(o.disabled);
  return [...base, ...o.custom].filter((m) => !disabled.has(m.slug));
}

export function loadPrompt(name: "cluster" | "add-by-url" | "day-summary" | "source-candidate" | "summary-refresh" | "media-gate" | "chapter-match" | "release-summary"): string {
  return readWithFallback(path.join("prompts", `${name}.md`), path.join("prompts", `${name}.example.md`));
}

export function siteUrl(): string {
  return process.env.SITE_URL || loadSiteConfig().bots.siteUrl || `https://${siteIdentity().domain}`;
}
