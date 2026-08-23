import { PodcastsClient, type PodcastsData } from "./PodcastsClient";
import { buildChrome, NotLoggedIn } from "../server";
import { isAdmin } from "@/lib/auth";
import { loadSiteConfig } from "@/lib/config";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin · Podcasts", robots: { index: false } };

export default async function AdminPodcastsPage() {
  if (!(await isAdmin())) return <NotLoggedIn />;

  const state = await loadState();
  const cfg = loadSiteConfig();
  const data: PodcastsData = {
    mediaItems: (state.mediaItems ?? []).slice(0, 60),
  };

  return (
    <main className="wrap page single admin">
      <PodcastsClient chrome={buildChrome(state, cfg)} data={data} />
    </main>
  );
}
