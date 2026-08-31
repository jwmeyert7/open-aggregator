import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminEditLink } from "@/components/AdminEditLink";
import { AgeStamp } from "@/components/AgeStamp";
import { effectiveFeeds } from "@/lib/config";
import { MediaPlayer } from "@/components/MediaPlayer";
import { SectionPill } from "@/components/ClusterCard";
import { isMediaFeed } from "@/lib/feeds";
import { formatViews, mediaThumb } from "@/lib/util";
import { liveClusters } from "@/lib/rank";
import { loadState } from "@/lib/state";
import { siteIdentity } from "@/lib/site";
import { sourceLink, sourceSlug } from "../shared";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const feed = effectiveFeeds(await loadState()).find((f) => sourceSlug(f.name) === slug);
  if (!feed) return {};
  if (isMediaFeed(feed)) {
    return { title: feed.name, description: `Episodes from ${feed.name} on the site.` };
  }
  return {
    title: feed.name,
    description: `Articles from ${feed.name} that ${siteIdentity().siteName} published.`,
  };
}

export default async function SourcePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const state = await loadState();
  // one display name can cover several feeds, and even both identities at
  // once: Bankless is a news outlet (its site's RSS) and two show feeds
  const named = effectiveFeeds(state).filter((f) => sourceSlug(f.name) === slug);
  const feed = named[0];
  if (!feed) notFound();
  const hasMedia = named.some((f) => isMediaFeed(f));
  const hasNews = named.some((f) => !isMediaFeed(f));
  const episodes = hasMedia
    ? (state.mediaItems ?? [])
        .filter((m) => !m.hidden && m.sourceName === feed.name)
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    : [];
  const episodeItems = episodes.map((m) => (
    <li key={m.id} className="media-item">
      <MediaPlayer
        id={`src-${m.id}`}
        url={m.url}
        kind={m.kind}
        title={m.displayTitle ?? m.title}
        thumbnail={mediaThumb(m)}
        tileText={m.sourceName}
        durationSec={m.durationSec}
        chapters={m.chapters}
        audioUrl={m.audioUrl}
        videoUrl={m.videoUrl}
        compact
      >
        <div className="media-body">
          <a href={m.videoUrl ?? m.url} rel="noopener" title={m.displayTitle ? `Show's title: ${m.title}` : undefined}>
            {m.displayTitle ?? m.title}
          </a>
          <div className="org">
            {m.kind}
            {m.section ? (
              <>
                {" · "}
                <SectionPill section={m.section} />
              </>
            ) : null}
            {formatViews(m.views) ? <> · {formatViews(m.views)} views</> : null} ·{" "}
            <AgeStamp iso={m.publishedAt} />{" "}
            <AdminEditLink href={`/admin/podcasts?episode=${m.id}`} />
          </div>
        </div>
      </MediaPlayer>
    </li>
  ));

  // a pure show's page lists its episodes, playable in place, instead of
  // article links: the show's output IS its coverage. An outlet that is also
  // a show (Bankless) keeps the articles page and gains an Episodes section.
  if (hasMedia && !hasNews) {
    const show = sourceLink(named.find((f) => isMediaFeed(f)) ?? feed);
    return (
      <main className="wrap page single roomy">
        <div className="prose">
          <h1>{feed.name}</h1>
          <p>
            Everything from <a href={show} rel="noopener">{feed.name}</a>{" "}that&apos;s on {siteIdentity().siteName}.
            Press a thumbnail to play it here.
            The full show list is on <Link href="/sources">Sources</Link>, and every show&apos;s episodes mix on the{" "}
            <Link href="/podcasts">podcasts page</Link>.
          </p>
          <ul className="media-list">
            {episodes.length === 0 ? (
              <li className="org">No episodes from this show are on the site right now. Its next one will appear here.</li>
            ) : null}
            {episodeItems}
          </ul>
        </div>
      </main>
    );
  }

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
          Everything from <a href={site} rel="noopener">{feed.name}</a>{" "}that&apos;s on {siteIdentity().siteName}. Each
          item links the story it appeared in. The full whitelist is on <Link href="/sources">Sources</Link>.
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
        {episodes.length > 0 ? (
          <>
            <h2>Episodes</h2>
            <ul className="media-list">{episodeItems}</ul>
          </>
        ) : null}
      </div>
    </main>
  );
}
