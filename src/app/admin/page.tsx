import Link from "next/link";
import { redirect } from "next/navigation";
import { buildChrome } from "./server";
import { AdminChrome, LoginForm } from "./shared";
import { isAdmin } from "@/lib/auth";
import { effectiveFeeds, loadSiteConfig } from "@/lib/config";
import { liveClusters, weekendMode } from "@/lib/rank";
import { loadState } from "@/lib/state";
import { timeAgo } from "@/lib/util";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin", robots: { index: false } };

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter } = await searchParams;
  // the story filter moved to its own page with the stories themselves
  if (filter) redirect(`/admin/stories?filter=${encodeURIComponent(filter)}`);

  if (!(await isAdmin())) {
    return (
      <main className="wrap page single admin">
        <LoginForm />
      </main>
    );
  }

  const state = await loadState();
  const cfg = loadSiteConfig();
  const chrome = buildChrome(state, cfg);
  const now = new Date();

  const stories = liveClusters(state).length;
  const sources = effectiveFeeds(state).length;
  const markets = [...(cfg.polymarket?.markets ?? []), ...(state.marketOverrides?.custom ?? [])].filter(
    (m) => !(state.marketOverrides?.disabled ?? []).includes(m.slug)
  ).length;
  const episodes = (state.mediaItems ?? []).filter((m) => !m.hidden).length;
  const lastRun = (state.runLog ?? [])[0];
  const layoutNow = weekendMode(cfg.ranking, now, state.weekendSchedule) ? "weekend" : "weekday";
  const sponsoredLive =
    (state.sponsoredPosts ?? []).filter((p) => !p.hidden).length +
    [...state.jobs, ...state.events, ...(state.podcasts ?? [])].filter((l) => !l.hidden).length;
  const announcement = state.announcement?.text
    ? state.announcement.hidden
      ? "saved, hidden"
      : "live"
    : "empty";

  const tools: Array<{ href: string; name: string; sub: string }> = [
    {
      href: "/admin/stories",
      name: "Stories",
      sub: `${stories} live · ${chrome.submissions} pending submission${chrome.submissions === 1 ? "" : "s"}`,
    },
    {
      href: "/admin/sources",
      name: "Sources",
      sub: `${sources} enabled · ${chrome.candidates} candidate${chrome.candidates === 1 ? "" : "s"} to judge`,
    },
    { href: "/admin/markets", name: "Markets", sub: `${markets} watched for swings` },
    { href: "/admin/podcasts", name: "Podcasts", sub: `${episodes} episode${episodes === 1 ? "" : "s"} on the site` },
    {
      href: "/admin/runs",
      name: "Runs",
      sub: lastRun ? `last run ${timeAgo(lastRun.at)} · ${lastRun.newItems} new item${lastRun.newItems === 1 ? "" : "s"}` : "no runs recorded yet",
    },
    { href: "/admin/layout", name: "Layout", sub: `${layoutNow} layout showing now` },
    {
      href: "/admin/email",
      name: "Email",
      sub: `${chrome.subscribers.daily} daily / ${chrome.subscribers.weekly} weekly subscribers`,
    },
    { href: "/admin/announcement", name: "Announcement", sub: announcement },
    { href: "/admin/sponsored", name: "Sponsored", sub: `${sponsoredLive} live across posts, jobs, events, and podcasts` },
    { href: "/admin/leaderboard", name: "Leaderboard", sub: "which sources earn their keep" },
    { href: "/admin/wordmap", name: "Word maps", sub: "preview clouds for the frozen editions" },
    { href: "/admin/farcaster", name: "Farcaster", sub: "the bot's activity and channel reads" },
  ];

  return (
    <main className="wrap page single admin">
      <div>
        <AdminChrome chrome={chrome} />
        <h2>Tools</h2>
        <div className="admin-tools">
          {tools.map((t) => (
            <Link key={t.href} href={t.href} className="admin-tool">
              <span className="tool-name">{t.name}</span>
              <span className="sub">{t.sub}</span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
