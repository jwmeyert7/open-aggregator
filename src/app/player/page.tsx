import { MediaPlayer } from "@/components/MediaPlayer";
import { youtubeVideoId } from "@/lib/feeds";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Player", robots: { index: false } };

/**
 * The detached window's page: just the player, the site chrome hidden by
 * CSS. When the video is one of the shelf's episodes, the page carries its
 * real title, length, and chapters. Playhead and play state share the same
 * localStorage keys as the main site, so the dock can pick up exactly where
 * this window leaves off.
 */
export default async function PlayerPage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string; f?: string; t?: string; paused?: string }>;
}) {
  const { v, f, t, paused } = await searchParams;
  const id = /^[A-Za-z0-9_-]{11}$/.test(v ?? "") ? v : undefined;
  // a direct-file episode detaches by its https file URL instead of a YouTube id
  const fileUrl = !id && f && /^https:\/\//.test(f) ? f : undefined;
  if (!id && !fileUrl) {
    return (
      <main className="player-page">
        <p className="empty-state">Nothing to play.</p>
      </main>
    );
  }
  const state = await loadState();
  const m = (state.mediaItems ?? []).find((x) =>
    !x.hidden && (id ? youtubeVideoId(x.videoUrl ?? x.url) === id : x.videoUrl === fileUrl)
  );
  const start = Number(t);
  return (
    <main className="player-page">
      <MediaPlayer
        id={id ? `win-${id}` : "win-file"}
        url={id ? `https://www.youtube.com/watch?v=${id}` : m?.url ?? fileUrl!}
        kind="video"
        title={m?.displayTitle ?? m?.title ?? "Episode"}
        durationSec={m?.durationSec}
        chapters={m?.chapters}
        {...(fileUrl ? { videoUrl: fileUrl, audioUrl: m?.audioUrl } : {})}
        compact
        autoOpen
        popOut={false}
        closeWindow
        startPaused={paused === "1"}
        startAt={Number.isFinite(start) && start > 0 ? start : undefined}
      >
        <span />
      </MediaPlayer>
    </main>
  );
}
