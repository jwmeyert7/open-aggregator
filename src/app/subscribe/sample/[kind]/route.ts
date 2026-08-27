import { NextResponse, type NextRequest } from "next/server";
import { loadSiteConfig, siteUrl } from "@/lib/config";
import { buildDailyEdition, buildMonthlyEdition, buildWeeklyEdition, recentEpisodes, type Edition } from "@/lib/digest";
import { loadDailyDigest, loadMonthlyDigest, loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

/**
 * What an edition looks like, as a web page, before anyone subscribes:
 * /subscribe/sample/daily and /subscribe/sample/weekly render the latest real
 * edition's HTML with the unsubscribe link neutralised. Nothing is sent and no
 * address is taken, so there is nothing here for a bot to abuse.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  if (kind !== "daily" && kind !== "weekly" && kind !== "monthly") return new NextResponse("Not found", { status: 404 });
  const state = await loadState();
  const cfg = loadSiteConfig();
  let edition: Edition | null = null;
  if (kind === "weekly") {
    edition = await buildWeeklyEdition(state, cfg, recentEpisodes(state, 7 * 24, 5));
  } else if (kind === "monthly") {
    // the newest FROZEN month: the in-progress current month was never sent
    for (const month of state.monthlyDigestMonths ?? []) {
      const digest = await loadMonthlyDigest(month);
      if (!digest || digest.inProgress) continue;
      edition = await buildMonthlyEdition(state, cfg, month);
      break;
    }
  } else {
    // the newest FROZEN day: the in-progress today was never sent
    for (const date of state.dailyDigestDates ?? []) {
      const digest = await loadDailyDigest(date);
      if (!digest || digest.inProgress) continue;
      edition = buildDailyEdition(digest, recentEpisodes(state, 24, 3));
      break;
    }
  }
  if (!edition) return new NextResponse("No edition to show yet. The first daily freezes at UTC midnight.", { status: 404 });
  const banner =
    `<p style="font-family: Georgia, serif; max-width: 640px; margin: 16px auto; padding: 10px 14px; border: 1px solid #ddd; border-radius: 6px; color: #555; font-size: 14px;">` +
    `A sample of the ${kind} edition, the most recent one sent. Subscribe at <a href="/subscribe">${escape(siteHost())}/subscribe</a>.</p>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${escape(edition.subject)}</title></head><body style="margin: 0; padding: 16px; background: #fff;">${banner}${edition.html.replace(/%%UNSUB%%/g, "/subscribe")}</body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=600" } });
}

function siteHost(): string {
  try {
    return new URL(siteUrl()).host;
  } catch {
    return siteUrl();
  }
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
