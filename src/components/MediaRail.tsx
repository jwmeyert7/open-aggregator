import Link from "next/link";
import { AdminEditLink } from "@/components/AdminEditLink";
import { AgeStamp } from "@/components/AgeStamp";
import { SectionPill, SourceKicker } from "@/components/ClusterCard";
import { MediaPlayer } from "@/components/MediaPlayer";
import type { MediaItem } from "@/lib/types";
import { formatViews, mediaThumb } from "@/lib/util";

/**
 * Podcasts: the newest whitelisted episodes, living in the middle column
 * (under any sponsored content) on the front page and, filtered to the
 * section's own episodes, on each section page. Renders nothing while empty.
 * At most two per show, so one prolific channel (an event uploading every
 * talk) never owns the box; /podcasts keeps the full list.
 */
export function MediaRail({ items, limit = 6, perShow = 2 }: { items: MediaItem[]; limit?: number; perShow?: number }) {
  const shown: MediaItem[] = [];
  const count = new Map<string, number>();
  for (const m of items) {
    const n = count.get(m.sourceId) ?? 0;
    if (n >= perShow) continue;
    count.set(m.sourceId, n + 1);
    shown.push(m);
    if (shown.length >= limit) break;
  }
  if (shown.length === 0) return null;
  return (
    <>
      {/* desktop label, styled like the column labels; the box's own h3 takes over on mobile */}
      <div className="media-label">
        <Link href="/podcasts">Podcasts</Link>
      </div>
      <div className="rail media-rail">
        <h3>
          <Link href="/podcasts">Podcasts</Link>
        </h3>
        <ul>
          {shown.map((m) => (
            <li key={m.id}>
              {/* the thumbnail opens a small player right here; the title still opens the source */}
              <MediaPlayer
                id={`box-${m.id}`}
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
                // same Techmeme-style kicker as the story cards: the show reads first, on its
                // own line, across the whole row, with thumbnail and title side by side beneath it
                header={<SourceKicker name={m.sourceName} />}
              >
                <div className="media-body">
                  <a href={m.videoUrl ?? m.url} rel="noopener" title={m.displayTitle ? `Show's title: ${m.title}` : undefined}>
                    {m.displayTitle ?? m.title}
                  </a>
                  <div className="org">
                    {m.section ? <><SectionPill section={m.section} /> · </> : null}
                    {formatViews(m.views) ? <>{formatViews(m.views)} views · </> : null}
                    <AgeStamp iso={m.publishedAt} />{" "}
                    <AdminEditLink href={`/admin/podcasts?episode=${m.id}`} />
                  </div>
                </div>
              </MediaPlayer>
            </li>
          ))}
        </ul>
        <div className="rail-more">
          <Link href="/podcasts">all podcasts →</Link>
        </div>
      </div>
    </>
  );
}
