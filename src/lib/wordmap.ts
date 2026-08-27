import type { DailyDigest, MonthlyDigest, WeeklyDigest, YearlyDigest } from "./types";

/**
 * Word map logic shared by the admin preview page and the PNG generator:
 * word extraction, the balanced selection rules, and the layout. All
 * deterministic per edition, so a day's map never changes between renders.
 */

export const WORDMAP_W = 1200;
export const WORDMAP_H = 630;
export const WORDMAP_MAX_WORDS = 40;

/**
 * One palette per site theme; the PNGs are generated once with each. The
 * configured sections take hues from sectionHues in nav order (cycling if a
 * site has more sections than hues); podcast and general keep their own.
 */
export const WORDMAP_PALETTES = {
  dark: {
    bg: "#15171b",
    brand: "#858b96",
    title: "#e8e8e4",
    podcast: "#f0c4a8",
    general: "#b8bcc4",
    sectionHues: ["#8b8ff0", "#7ee8d8", "#c5b0f2", "#f0b0c8", "#a8d0f0", "#d4e0a0"],
  },
  light: {
    bg: "#f7f7f5",
    brand: "#8b919b",
    title: "#24272e",
    podcast: "#b25a1e",
    general: "#5f646d",
    sectionHues: ["#4046c8", "#0d7f6e", "#6f46c4", "#b03a6e", "#1f6fa8", "#6b7a1e"],
  },
};

/**
 * The knobs the site's config feeds into the shared word map logic. This
 * module stays free of config and fs imports on purpose: the client cloud
 * component imports it, so the server callers pass these in instead.
 */
export interface WordmapSiteConfig {
  /** The configured nav section ids, in nav order (without podcast/general). */
  sections: string[];
  /** Extra stop words: the site's own topic vocabulary, every day's background. */
  extraStop?: string[];
}

/** The per-section word colors for one theme, built from the configured sections. */
export function wordmapColors(theme: keyof typeof WORDMAP_PALETTES, sections: string[]): Record<string, string> {
  const p = WORDMAP_PALETTES[theme];
  const map: Record<string, string> = { podcast: p.podcast, general: p.general };
  sections.forEach((id, i) => {
    map[id] = p.sectionHues[i % p.sectionHues.length];
  });
  return map;
}

/** Texture without a second typeface: the big words carry more weight. */
export function wordFontWeight(size: number): number {
  return size >= 46 ? 700 : size >= 30 ? 600 : 500;
}

/** Words too common to say anything about a particular day. */
const STOP_BASE = new Set(
  (
    "the a an and or of to for in on with as by from at is are was were be been after before amid over into onto up out " +
    "new now his her its it this that these those will would could should has have had not no more most other own via " +
    "than then when while during between about against ahead despite toward towards under off says say said sets set " +
    "gets get goes go first second next last per amid"
  ).split(" ")
);

/**
 * The stop list plus the site's own topic words: the topic is every day's
 * background, not a signal, so its words never earn a spot on a map.
 */
function stopWords(extraStop?: string[]): Set<string> {
  const s = new Set(STOP_BASE);
  for (const w of extraStop ?? []) {
    if (w.length >= 3) s.add(w.toLowerCase());
  }
  return s;
}

export interface WordmapSource {
  text: string;
  weight: number;
  section: string;
  href: string;
}

export interface WordmapWord {
  text: string;
  weight: number;
  section: string;
  href: string;
}

export interface PlacedWord extends WordmapWord {
  x: number;
  y: number;
  size: number;
}

/** The weighted texts an edition contributes, each remembering its story. */
export function editionTexts(d: DailyDigest | WeeklyDigest | MonthlyDigest | YearlyDigest): WordmapSource[] {
  const texts: WordmapSource[] = [];
  for (const c of d.clusters) {
    const sec = c.section === "general" ? "general" : c.section;
    texts.push({ text: c.headline, weight: 3, section: sec, href: `/story/${c.slug}` });
    if (c.explainer) texts.push({ text: c.explainer, weight: 1, section: sec, href: `/story/${c.slug}` });
    // the coverage's own titles: real vocabulary that keeps a thin edition's
    // map from being one headline repeated in different sizes
    for (const l of c.links.slice(0, 6)) {
      texts.push({ text: l.title, weight: 1, section: sec, href: `/story/${c.slug}` });
    }
  }
  if ("alsoActive" in d) {
    for (const a of d.alsoActive ?? []) {
      texts.push({ text: a.headline, weight: 2, section: a.section ?? "general", href: `/story/${a.slug}` });
    }
  }
  for (const m of d.episodes ?? []) {
    texts.push({ text: m.displayTitle ?? m.title, weight: 2, section: "podcast", href: `/podcasts?play=${m.id}#m-${m.id}` });
  }
  return texts;
}

/**
 * Weighted word frequencies with the house selection rules: stop words and
 * number fragments out, duplicates merged (majority casing wins), every
 * section that produced words gets its top slice, a section's slice links at
 * least two distinct stories whenever it has two, capped at 40 words.
 */
export function extractWords(texts: WordmapSource[], site: WordmapSiteConfig): WordmapWord[] {
  const agg = new Map<
    string,
    {
      weight: number;
      casings: Map<string, number>;
      bySection: Map<string, number>;
      byHref: Map<string, number>;
      hrefBySection: Map<string, Map<string, number>>;
    }
  >();
  const stop = stopWords(site.extraStop);
  for (const t of texts) {
    for (const raw of t.text.split(/[^A-Za-z0-9'’.-]+/)) {
      const cleaned = raw.replace(/^['’.-]+|['’.-]+$/g, "");
      if (cleaned.length < 3) continue;
      // numbers and number-ish fragments ("8.5", "2,026", "11.3B", "50k") say nothing alone
      if (/^\d+([.,]\d+)*[A-Za-z]{0,2}$/.test(cleaned)) continue;
      const key = cleaned.toLowerCase();
      if (stop.has(key)) continue;
      const a =
        agg.get(key) ??
        { weight: 0, casings: new Map(), bySection: new Map(), byHref: new Map(), hrefBySection: new Map() };
      a.weight += t.weight;
      a.casings.set(cleaned, (a.casings.get(cleaned) ?? 0) + 1);
      a.bySection.set(t.section, (a.bySection.get(t.section) ?? 0) + t.weight);
      a.byHref.set(t.href, (a.byHref.get(t.href) ?? 0) + t.weight);
      const hb = a.hrefBySection.get(t.section) ?? new Map<string, number>();
      hb.set(t.href, (hb.get(t.href) ?? 0) + t.weight);
      a.hrefBySection.set(t.section, hb);
      agg.set(key, a);
    }
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
  const all = [...agg.entries()]
    .map(([key, a]) => ({
      text: top(a.casings) ?? key,
      weight: a.weight,
      section: top(a.bySection) ?? "general",
      href: top(a.byHref) ?? "",
    }))
    .sort((a, b) => b.weight - a.weight);
  const chosen = new Map<string, WordmapWord>();
  for (const sec of [...site.sections, "podcast"]) {
    const inSec = all.filter((x) => x.section === sec);
    const slice = inSec.slice(0, 8);
    const hrefs = new Set(slice.map((w) => w.href));
    if (hrefs.size === 1) {
      const second = inSec.filter((w) => !hrefs.has(w.href));
      const secondHref = second[0]?.href;
      const add = second.filter((w) => w.href === secondHref).slice(0, 3);
      slice.splice(slice.length - add.length, add.length, ...add);
    }
    for (const w of slice) chosen.set(w.text, w);
    if (slice.length === 0) {
      // every category the edition wrote about must appear: majority-section
      // assignment can starve a light category whose words also show up
      // elsewhere, so borrow its strongest unclaimed words in its own color.
      // A category with truly no source text (a day with no such stories, or
      // podcast before podcasts existed) stays absent, honestly.
      const cands = [...agg.entries()]
        .filter(([key, a]) => (a.bySection.get(sec) ?? 0) > 0 && !chosen.has(top(a.casings) ?? key))
        .sort((x, y) => (y[1].bySection.get(sec) ?? 0) - (x[1].bySection.get(sec) ?? 0))
        .slice(0, 3);
      for (const [key, a] of cands) {
        const text = top(a.casings) ?? key;
        chosen.set(text, {
          text,
          weight: a.bySection.get(sec) ?? 1,
          section: sec,
          href: top(a.hrefBySection.get(sec) ?? new Map()) ?? top(a.byHref) ?? "",
        });
      }
    }
  }
  for (const w of all) {
    if (chosen.size >= WORDMAP_MAX_WORDS) break;
    if (!chosen.has(w.text)) chosen.set(w.text, w);
  }
  return [...chosen.values()].sort((a, b) => b.weight - a.weight);
}

/** Per-category distribution of a map: word and story counts with shares. */
export function wordmapStats(words: WordmapWord[], sections: string[]): Array<{ section: string; words: number; wordPct: number; stories: number; storyPct: number }> {
  const bySec = new Map<string, { words: number; hrefs: Set<string> }>();
  for (const w of words) {
    const s = bySec.get(w.section) ?? { words: 0, hrefs: new Set<string>() };
    s.words += 1;
    if (w.href) s.hrefs.add(w.href);
    bySec.set(w.section, s);
  }
  const totalWords = words.length || 1;
  const totalStories = [...bySec.values()].reduce((n, s) => n + s.hrefs.size, 0) || 1;
  return [...sections, "podcast", "general"]
    .filter((sec) => bySec.has(sec))
    .map((sec) => {
      const s = bySec.get(sec)!;
      return {
        section: sec,
        words: s.words,
        wordPct: Math.round((s.words / totalWords) * 100),
        stories: s.hrefs.size,
        storyPct: Math.round((s.hrefs.size / totalStories) * 100),
      };
    });
}

/** Tiny deterministic PRNG seeded by the edition, so a map never reflows. */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

/** Approximate text box for layout and for centering in the PNG generator. */
export function wordBox(text: string, size: number): { w: number; h: number } {
  return { w: size * 0.58 * text.length + 4, h: size * 1.05 };
}

/**
 * Each section owns a direction from the center, so its words cluster
 * together: the configured sections plus podcast and general, spread evenly
 * around the circle from a fixed starting angle.
 */
function sectionAngles(sections: string[]): Record<string, number> {
  const ids = [...sections, "podcast", "general"];
  const angles: Record<string, number> = {};
  ids.forEach((id, i) => {
    // a large fixed stride scrambles neighbors, so adjacent nav sections do
    // not sit side by side and the map reads mixed
    angles[id] = (195 + i * 150) % 360;
  });
  return angles;
}

function hashStr(s: string): number {
  let h = 5381;
  for (const ch of s) h = (h * 33 + ch.charCodeAt(0)) | 0;
  return h >>> 0;
}

/**
 * The layout: one central term from the day's top story sits dead center and
 * everything radiates from it, smaller with rank. Each section's words
 * spiral out around that section's own compass direction (with a per-story
 * nudge), so the colors form spatial neighborhoods. All text horizontal.
 */
export function layoutCloud(
  words: WordmapWord[],
  seed: string,
  sections: string[],
  topHref?: string,
  storyRanks?: Map<string, number>
): PlacedWord[] {
  if (words.length === 0) return [];
  // if a scale overfills the canvas (words fail to place), the whole layout
  // retries smaller until every word fits
  for (const scale of [1, 0.9, 0.8, 0.72, 0.64, 0.56]) {
    const attempt = layoutAttempt(words, seed, sections, topHref, scale, storyRanks);
    if (attempt.length === words.length) return attempt;
    if (scale === 0.56) return attempt;
  }
  return [];
}

/** The top story shouts, the second speaks, everything else is texture. */
function storyMultiplier(href: string, storyRanks?: Map<string, number>): number {
  const rank = storyRanks?.get(href);
  return rank === 0 ? 1 : rank === 1 ? 0.85 : 0.6;
}

function layoutAttempt(
  words: WordmapWord[],
  seed: string,
  sections: string[],
  topHref: string | undefined,
  scale: number,
  storyRanks?: Map<string, number>
): PlacedWord[] {
  const rand = rng(seed);
  const angles = sectionAngles(sections);
  // the central term: the heaviest word from the top story, else the heaviest overall
  const centerIdx = Math.max(
    0,
    words.findIndex((w) => topHref && w.href === topHref)
  );
  const ordered = [words[centerIdx], ...words.filter((_, i) => i !== centerIdx)];
  const eff = (w: WordmapWord) => w.weight * storyMultiplier(w.href, storyRanks);
  const max = Math.max(...ordered.map(eff));
  const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
  const out: PlacedWord[] = [];
  const PAD = 6;
  const CX = WORDMAP_W / 2;
  const CY = WORDMAP_H / 2;
  // the title block (the edition title over the site name) owns the top-left
  // corner: reserve its rectangle so no word ever sits under it
  placed.push({ x: 300, y: 70, w: 560, h: 120 });
  for (const [i, word] of ordered.entries()) {
    // a steeper curve than sqrt, so the size gap between the loud stories
    // and the texture words is visible at a glance
    const size = Math.round((18 + 62 * Math.pow(eff(word) / max, 0.7)) * scale);
    const { w, h } = wordBox(word.text, size);
    // anchor: the center for the central term; a section direction (nudged
    // per story) for everything else
    let ax = CX;
    let ay = CY;
    if (i > 0) {
      const base = angles[word.section] ?? angles.general;
      const nudge = ((hashStr(word.href) % 5) - 2) * 11;
      const rad = ((base + nudge) * Math.PI) / 180;
      ax = CX + Math.cos(rad) * 210 * 1.35;
      ay = CY - Math.sin(rad) * 150;
    }
    const start = rand() * Math.PI * 2;
    let done = false;
    // first pass spirals around the word's section anchor; if the
    // neighborhood is full (or out of bounds), a second pass spirals from
    // the center so no word is ever dropped
    for (const [ox, oy] of [
      [ax, ay],
      [CX, CY],
    ]) {
      for (let step = 0; step < 2600 && !done; step++) {
        const angle = start + step * 0.3;
        const r = 1.5 * step * 0.3;
        const x = ox + r * Math.cos(angle) * 1.45;
        const y = oy + r * Math.sin(angle) * 0.8;
        if (x - w / 2 < 8 || x + w / 2 > WORDMAP_W - 8 || y - h / 2 < 8 || y + h / 2 > WORDMAP_H - 8) continue;
        const hits = placed.some(
          (p) => Math.abs(x - p.x) * 2 < w + p.w + PAD && Math.abs(y - p.y) * 2 < h + p.h + PAD
        );
        if (!hits) {
          placed.push({ x, y, w, h });
          out.push({ ...word, x, y, size });
          done = true;
        }
      }
      if (done) break;
    }
  }
  // re-center the finished cloud: anchor geometry can leave one side airy,
  // so the bounding box shifts back onto the canvas center. Bounds-safe, and
  // skipped entirely if the shift would push any word under the title block
  // (placed[0] is the title's reserved rectangle).
  if (out.length > 0) {
    const reserve = placed[0];
    const rects = placed.slice(1, out.length + 1);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of rects) {
      minX = Math.min(minX, p.x - p.w / 2);
      maxX = Math.max(maxX, p.x + p.w / 2);
      minY = Math.min(minY, p.y - p.h / 2);
      maxY = Math.max(maxY, p.y + p.h / 2);
    }
    const dx = Math.max(8 - minX, Math.min(CX - (minX + maxX) / 2, WORDMAP_W - 8 - maxX));
    const dy = Math.max(8 - minY, Math.min(CY - (minY + maxY) / 2, WORDMAP_H - 8 - maxY));
    const collides = rects.some(
      (p) =>
        Math.abs(p.x + dx - reserve.x) * 2 < p.w + reserve.w && Math.abs(p.y + dy - reserve.y) * 2 < p.h + reserve.h
    );
    if (!collides) {
      for (const p of out) {
        p.x += dx;
        p.y += dy;
      }
    }
  }
  return out;
}
