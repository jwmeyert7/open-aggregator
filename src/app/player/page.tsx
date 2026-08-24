import { MediaPlayer } from "@/components/MediaPlayer";

export const metadata = { title: "Player", robots: { index: false } };

/**
 * The plain popup window's page: just the player, the site chrome hidden by
 * CSS. Playhead memory shares the same localStorage keys as the main site,
 * so position stays consistent across windows.
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
  const start = Number(t);
  return (
    <main className="player-page">
      <MediaPlayer
        id={`win-${id}`}
        url={`https://www.youtube.com/watch?v=${id}`}
        kind="video"
        title="Episode"
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
