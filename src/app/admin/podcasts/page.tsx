import { PodcastsClient, type PodcastsData } from "./PodcastsClient";
import { buildChrome, NotLoggedIn } from "../server";
import { isAdmin } from "@/lib/auth";
import { loadSiteConfig } from "@/lib/config";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin · Podcasts", robots: { index: false } };

export default async function AdminPodcastsPage({ searchParams }: { searchParams: Promise<{ episode?: string }> }) {
  const { episode } = await searchParams;
  if (!(await isAdmin())) return <NotLoggedIn />;

  const state = await loadState();
  const cfg = loadSiteConfig();
  const all = state.mediaItems ?? [];
  const sliced = all.slice(0, 60);
  // an edit link's target must be reachable even when it sits past the cap
  if (episode && !sliced.some((m) => m.id === episode)) {
    const extra = all.find((m) => m.id === episode);
    if (extra) sliced.unshift(extra);
  }
  const data: PodcastsData = {
    sections: cfg.sections.map((s) => s.id),
    mediaItems: sliced,
    scheduled: [...(state.scheduledEpisodes ?? [])].sort((a, b) => (a.scheduledAt ?? a.seenAt).localeCompare(b.scheduledAt ?? b.seenAt)),
  };

  return (
    <main className="wrap page single admin">
      <PodcastsClient chrome={buildChrome(state, cfg)} data={data} initialEpisodeId={episode} />
    </main>
  );
}
