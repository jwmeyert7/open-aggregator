import Link from "next/link";
import { AgeStamp } from "@/components/AgeStamp";
import { MediaPlayer } from "@/components/MediaPlayer";
import { NewItemsButton } from "@/components/NewItemsButton";
import { newestEntries } from "@/lib/rank";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Newest" };

/** Mobile home of the Newest rail: same compact look, more items. */
export default async function NewPage() {
  const state = await loadState();
  const items = newestEntries(state, 40);

  return (
    <main className="wrap page single">
      <div className="rail">
        <NewItemsButton latestId={state.items[0]?.id} />
        <h3>Newest</h3>
        <ul>
          {items.length === 0 ? <li className="org">Nothing yet.</li> : null}
          {items.map((i) =>
            i.episode ? (
              <li key={i.id} className="newest-item newest-episode">
                <MediaPlayer
                  id={`new-${i.episode.id}`}
                  url={i.episode.url}
                  kind={i.episode.kind}
                  title={i.episode.displayTitle ?? i.episode.title}
                  thumbnail={i.episode.thumbnail}
                  audioUrl={i.episode.audioUrl}
                  videoUrl={i.episode.videoUrl}
                  compact
                >
                  <div className="media-body">
                    <a href={i.url} rel="noopener" title={i.rawTitle && i.rawTitle !== i.title ? `Show's title: ${i.rawTitle}` : undefined}>
                      {i.title}
                    </a>
                    <div className="org">
                      <span className="kind-tag">podcast</span>
                      {i.sourceName} · <AgeStamp iso={i.publishedAt} />
                    </div>
                  </div>
                </MediaPlayer>
              </li>
            ) : (
              <li key={i.id} className="newest-item">
                <a href={i.url} rel="noopener" title={i.rawTitle && i.rawTitle !== i.title ? `Source title: ${i.rawTitle}` : undefined}>
                  {i.title}
                </a>
                <div className="org">
                  {i.sourceName} · <AgeStamp iso={i.publishedAt} />
                </div>
              </li>
            )
          )}
        </ul>
        <div className="rail-more">
          <Link href="/stream">full stream →</Link>
        </div>
      </div>
    </main>
  );
}
