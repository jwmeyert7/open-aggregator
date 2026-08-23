import { LayoutClient, type LayoutData } from "./LayoutClient";
import { buildChrome, NotLoggedIn } from "../server";
import { adminLayoutPreview, isAdmin } from "@/lib/auth";
import { loadSiteConfig } from "@/lib/config";
import { defaultWeekendSchedule, weekendMode } from "@/lib/rank";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin · Layout", robots: { index: false } };

export default async function AdminLayoutPage() {
  if (!(await isAdmin())) return <NotLoggedIn />;

  const state = await loadState();
  const cfg = loadSiteConfig();
  const now = new Date();
  const data: LayoutData = {
    preview: await adminLayoutPreview(),
    scheduled: weekendMode(cfg.ranking, now, state.weekendSchedule) ? "weekend" : "weekday",
    schedule: state.weekendSchedule ?? defaultWeekendSchedule(cfg.ranking),
    custom: Boolean(state.weekendSchedule),
  };

  return (
    <main className="wrap page single admin">
      <LayoutClient chrome={buildChrome(state, cfg)} data={data} />
    </main>
  );
}
