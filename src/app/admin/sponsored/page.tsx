import { SponsoredClient, type SponsoredData } from "./SponsoredClient";
import { buildChrome, NotLoggedIn } from "../server";
import { isAdmin } from "@/lib/auth";
import { loadSiteConfig } from "@/lib/config";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin · Sponsored", robots: { index: false } };

export default async function AdminSponsoredPage() {
  if (!(await isAdmin())) return <NotLoggedIn />;

  const state = await loadState();
  const cfg = loadSiteConfig();
  const data: SponsoredData = {
    sections: cfg.sections.map((s) => s.id),
    sponsorPageEnabled: Boolean(state.sponsorPageEnabled),
    sponsoredPosts: state.sponsoredPosts ?? [],
    jobs: state.jobs,
    events: state.events,
    podcasts: state.podcasts ?? [],
  };

  return (
    <main className="wrap page single admin">
      <SponsoredClient chrome={buildChrome(state, cfg)} data={data} />
    </main>
  );
}
