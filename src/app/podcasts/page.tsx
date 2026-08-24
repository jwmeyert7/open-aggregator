import Link from "next/link";
import { AgeStamp } from "@/components/AgeStamp";
import { SectionPill } from "@/components/ClusterCard";
import { MediaPlayer } from "@/components/MediaPlayer";
import { loadSiteConfig } from "@/lib/config";
import { adaptiveRanking, episodeStories, rankMedia } from "@/lib/rank";
import { siteIdentity } from "@/lib/site";
import { loadState } from "@/lib/state";
import { formatMoment, formatViews, mediaThumb } from "@/lib/util";

export const dynamic = "force-dynamic";

export const metadata = { title: "Podcasts" };

/** House style for this copy: no em dashes, no semicolons. */
export default async function PodcastsPage({ searchParams }: { searchParams: Promise<{ play?: string; t?: string }> }) {
  const { play, t } = await searchParams;
  const startAt = t && /^\d+$/.test(t) ? Number(t) : undefined;
  const state = await loadState();
  const site = siteIdentity();
  const items = (state.mediaItems ?? []).filter((m) => !m.hidden).slice(0, 100);
  const covered = episodeStories(state);
  const cfg = loadSiteConfig();
  const weekAgo = Date.now() - 7 * 24 * 60 * 60000;
  const top = rankMedia(
    items.filter((m) => Date.parse(m.publishedAt) >= weekAgo),
    state,
    adaptiveRanking(state, cfg.ranking)
  ).slice(0, 6);
  return (
    <main className="wrap page single">
      <div>
        <div className="section-head">
          <h1>Podcasts</h1>
          <p>
            New podcast episodes and videos about {site.topic} from whitelisted shows, newest first. Episodes from
            broader shows appear only when they are substantially about {site.topic}. Press a thumbnail to play it
            here, or the title to open it at the source. The written news lives on the{" "}
            <Link href="/">front page</Link>.
          </p>
        </div>
        {items.length === 0 ? <p className="empty-state">Nothing on the shelf yet.</p> : null}
        {top.length >= 3 ? (
          <section className="media-top">
            <h2 className="list-label">Top this week</h2>
            <ol>
              {top.map((m) => (
                <li key={m.id}>
                  <a href={`#m-${m.id}`}>{m.displayTitle ?? m.title}</a>{" "}
                  <span className="org">
                    · {m.sourceName}
                    {formatViews(m.views) ? <> · {formatViews(m.views)} views</> : null}
                  </span>
                </li>
              ))}
            </ol>
            <h2 className="list-label">All episodes, newest first</h2>
          </section>
        ) : null}
        <ul className="media-list">
          {items.map((m) => (
            <li key={m.id} id={`m-${m.id}`} className="media-item">
              <MediaPlayer
                id={m.id}
                url={m.url}
                kind={m.kind}
                title={m.displayTitle ?? m.title}
                thumbnail={mediaThumb(m)}
                tileText={m.sourceName}
                durationSec={m.durationSec}
                audioUrl={m.audioUrl}
                videoUrl={m.videoUrl}
                autoOpen={play === m.id}
                startAt={play === m.id ? startAt : undefined}
              >
                <div className="media-body">
                  {/* the show reads first, on its own line, like the story cards */}
                  <div className="kicker">{m.sourceName}:</div>
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
                    <AgeStamp iso={m.publishedAt} />
                  </div>
                  {(covered.get(m.id) ?? []).length > 0 ? (
                    <ul className="episode-stories">
                      {(covered.get(m.id) ?? []).slice(0, 6).map((c) => (
                        <li key={c.id}>
                          {c.at !== undefined ? (
                            <Link href={`/podcasts?play=${m.id}&t=${c.at}#m-${m.id}`} className="moment" title="Play the episode here, from this moment">
                              {formatMoment(c.at)}
                            </Link>
                          ) : null}{" "}
                          <Link href={`/story/${c.slug}`}>{c.headline}</Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </MediaPlayer>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
