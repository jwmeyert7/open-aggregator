import { AgeStamp } from "@/components/AgeStamp";
import { SectionPill, SourceKicker } from "@/components/ClusterCard";
import { MediaPlayer } from "@/components/MediaPlayer";
import type { MediaItem } from "@/lib/types";
import { formatViews, mediaThumb } from "@/lib/util";

/** A frozen digest's episodes, playable exactly like everywhere else on the site. */
export function DigestEpisodes({ episodes, idPrefix }: { episodes: MediaItem[]; idPrefix: string }) {
  return (
    <ul className="media-list">
      {episodes.map((m) => (
        <li key={m.id} className="media-item">
          <MediaPlayer
            id={`${idPrefix}-${m.id}`}
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
            header={<SourceKicker name={m.sourceName} />}
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
                {formatViews(m.views) ? <> · {formatViews(m.views)} views</> : null} · <AgeStamp iso={m.publishedAt} />
              </div>
            </div>
          </MediaPlayer>
        </li>
      ))}
    </ul>
  );
}
