import { liveClusters } from "@/lib/rank";
import type { SiteState } from "@/lib/types";
import { bylineNames, nameSlug, showableByline } from "@/lib/util";

export interface WriterArticle {
  title: string;
  url: string;
  sourceName: string;
  publishedAt: string;
  story: { slug: string; headline: string };
}

export interface Writer {
  slug: string;
  name: string;
  outlets: string[];
  articles: WriterArticle[];
}

/**
 * Every writer named on a live story's coverage, keyed by name slug. Bylines
 * only exist on links ingested since the field was added, so this is a
 * growing catalog, not a complete one. The display name is the spelling
 * seen most often, so "Jane Doe" and "jane doe" land on one page.
 */
export function writers(state: SiteState): Map<string, Writer> {
  type Draft = Writer & { spellings: Map<string, number> };
  const out = new Map<string, Draft>();
  for (const c of liveClusters(state)) {
    if (c.mergedInto) continue;
    for (const l of c.links) {
      const byline = showableByline(l.byline, l.sourceName);
      if (!byline) continue;
      for (const n of bylineNames(byline)) {
        const slug = nameSlug(n);
        if (!slug) continue;
        const w: Draft = out.get(slug) ?? { slug, name: n, outlets: [], articles: [], spellings: new Map<string, number>() };
        w.spellings.set(n, (w.spellings.get(n) ?? 0) + 1);
        if (!w.outlets.includes(l.sourceName)) w.outlets.push(l.sourceName);
        if (!w.articles.some((a) => a.url === l.url)) {
          w.articles.push({
            title: l.title,
            url: l.url,
            sourceName: l.sourceName,
            publishedAt: l.publishedAt,
            story: { slug: c.slug, headline: c.headline },
          });
        }
        out.set(slug, w);
      }
    }
  }
  const result = new Map<string, Writer>();
  for (const w of out.values()) {
    const name = [...w.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0];
    w.articles.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    result.set(w.slug, { slug: w.slug, name, outlets: w.outlets, articles: w.articles });
  }
  return result;
}
