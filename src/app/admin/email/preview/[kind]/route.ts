import { buildDailyEdition, buildMonthlyEdition, buildWeeklyEdition, recentEpisodes, type Edition } from "@/lib/digest";
import { isAdmin } from "@/lib/auth";
import { loadSiteConfig, siteUrl } from "@/lib/config";
import { loadDailyDigest, loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

/**
 * The digest email rendered in the browser, admin-only: exactly the HTML a
 * subscriber would receive, without mailing yourself to see it. The
 * unsubscribe placeholder points at /subscribe like the admin test sends do.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  if (!(await isAdmin())) return new Response("Not found", { status: 404 });
  const { kind } = await params;
  const state = await loadState();
  const cfg = loadSiteConfig();

  let edition: Edition | null = null;
  if (kind === "weekly") {
    edition = await buildWeeklyEdition(state, cfg);
  } else if (kind === "monthly") {
    const month = (state.monthlyDigestMonths ?? [])[0];
    if (month) edition = await buildMonthlyEdition(state, cfg, month);
  } else if (kind === "daily") {
    const today = new Date().toISOString().slice(0, 10);
    const date = (state.dailyDigestDates ?? []).find((d) => d !== today);
    const digest = date ? await loadDailyDigest(date) : null;
    if (digest) edition = buildDailyEdition(digest, recentEpisodes(state, 24, 3));
  } else {
    return new Response("Not found", { status: 404 });
  }
  if (!edition) return new Response(`Nothing to preview for the ${kind} edition yet.`, { status: 200 });

  return new Response(edition.html.replaceAll("%%UNSUB%%", `${siteUrl()}/subscribe`), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
