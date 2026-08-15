import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AgeStamp } from "@/components/AgeStamp";
import { effectiveFeeds } from "@/lib/config";
import { liveClusters } from "@/lib/rank";
import { loadState } from "@/lib/state";
import { siteIdentity } from "@/lib/site";
import { sourceLink, sourceSlug } from "../shared";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const feed = effectiveFeeds(await loadState()).find((f) => sourceSlug(f.name) === slug);
  if (!feed) return {};
  return {
    title: feed.name,
    description: `Articles from ${feed.name} that ${siteIdentity().siteName} published.`,
  };
}

export default async function SourcePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const state = await loadState();
  const feed = effectiveFeeds(state).find((f) => sourceSlug(f.name) === slug);
  if (!feed) notFound();

  // matched on display name so an outlet read through two feeds is one page,
  // and so articles survive their feed being swapped for a better one
  const articles = new Map<string, { title: string; url: string; publishedAt: string; story: { slug: string; headline: string } }>();
  for (const c of liveClusters(state)) {
    if (c.mergedInto) continue;
    for (const l of c.links) {
      if (l.sourceName !== feed.name || articles.has(l.url)) continue;
      articles.set(l.url, {
        title: l.title,
        url: l.url,
        publishedAt: l.publishedAt,
        story: { slug: c.slug, headline: c.headline },
      });
    }
  }
  const rows = [...articles.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 100);
  const site = sourceLink(feed);

  return (
    <main className="wrap page single roomy">
      <div className="prose">
        <h1>{feed.name}</h1>
        <p>
          Every article from <a href={site} rel="noopener">{feed.name}</a> in a story right now, newest first. Each
          one links the story it appeared in. The full whitelist is on <Link href="/sources">Sources</Link>.
        </p>
        <ul>
          {rows.length === 0 ? (
            <li className="org">Nothing from this source is in a current story. Its next article will appear here.</li>
          ) : null}
          {rows.map((r) => (
            <li key={r.url} className="newest-item">
              <a href={r.url} rel="noopener">
                {r.title}
              </a>
              <div className="org">
                <AgeStamp iso={r.publishedAt} /> · in <Link href={`/story/${r.story.slug}`}>{r.story.headline}</Link>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
