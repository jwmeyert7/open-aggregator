import { MediaPlayer } from "@/components/MediaPlayer";
import { youtubeVideoId } from "@/lib/feeds";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Player", robots: { index: false } };

/**
 * The detached window's page: just the player, the site chrome hidden by
 * CSS. When the video is one of the shelf's episodes, the page carries its
 * real title, length, and chapters, so the window can jump around the
 * episode. Playhead memory shares the same localStorage keys as the main
 * site, so position stays consistent across windows.
 */
export default async function PlayerPage({ searchParams }: { searchParams: Promise<{ v?: string; t?: string }> }) {
  const { v, t } = await searchParams;
  const id = /^[A-Za-z0-9_-]{11}$/.test(v ?? "") ? v : undefined;
  if (!id) {
    return (
      <main className="player-page">
        <p className="empty-state">Nothing to play.</p>
      </main>
    );
  }
  const state = await loadState();
  const m = (state.mediaItems ?? []).find((x) => !x.hidden && youtubeVideoId(x.videoUrl ?? x.url) === id);
  const start = Number(t);
  return (
    <main className="player-page">
      <MediaPlayer
        id={`win-${id}`}
        url={`https://www.youtube.com/watch?v=${id}`}
        kind="video"
        title={m?.displayTitle ?? m?.title ?? "Episode"}
        durationSec={m?.durationSec}
        chapters={m?.chapters}
        compact
        autoOpen
        popOut={false}
        closeWindow
        startAt={Number.isFinite(start) && start > 0 ? start : undefined}
      >
        <span />
      </MediaPlayer>
    </main>
  );
}
