import { AnnouncementClient, type AnnouncementData } from "./AnnouncementClient";
import { buildChrome, NotLoggedIn } from "../server";
import { isAdmin } from "@/lib/auth";
import { loadSiteConfig } from "@/lib/config";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin · Announcement", robots: { index: false } };

export default async function AdminAnnouncementPage() {
  if (!(await isAdmin())) return <NotLoggedIn />;

  const state = await loadState();
  const cfg = loadSiteConfig();
  const data: AnnouncementData = {
    announcement: state.announcement ?? null,
  };

  return (
    <main className="wrap page single admin">
      <AnnouncementClient chrome={buildChrome(state, cfg)} data={data} />
    </main>
  );
}
