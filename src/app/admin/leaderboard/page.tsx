import Link from "next/link";
import { LeaderboardTable } from "./LeaderboardTable";
import { isAdmin } from "@/lib/auth";
import { effectiveFeeds, loadSiteConfig } from "@/lib/config";
import { leadLink, liveClusters, score } from "@/lib/rank";
import { loadState } from "@/lib/state";
import { hoursAgo, utcDay } from "@/lib/util";

export const dynamic = "force-dynamic";

export const metadata = { title: "Source Leaderboard", robots: { index: false } };

const WINDOW_DAYS = 30;

/**
 * Admin-only for now. To promote it to the public site later, move this file
 * to src/app/leaderboard/page.tsx and drop the isAdmin() gate.
 */
export default async function LeaderboardPage() {
  if (!(await isAdmin())) {
    return (
      <main className="wrap page single admin">
        <p className="status-line">
          Not logged in. <Link href="/admin">Go to the admin</Link> first.
        </p>
      </main>
    );
  }

  const state = await loadState();
  const cfg = loadSiteConfig();
  const clusters = liveClusters(state);

  const feeds = effectiveFeeds(state);
  // rows are keyed by display name, not feed id: an outlet read through two
  // feeds (the Politico politics + congress pair) is one source to the reader
  // and must be one row, exactly as the public sources page merges it
  const stats = new Map<string, { name: string; added: string; stories: number; leads: number; items: number; points: number }>();
  const get = (name: string) => {
    const s = stats.get(name) ?? { name, added: "", stories: 0, leads: 0, items: 0, points: 0 };
    stats.set(name, s);
    return s;
  };
  // maps a feed id to its display name for the gate counters, learning the
  // names of since-removed sources from the link history as it goes
  const nameById = new Map<string, string>();
  // every configured source gets a row, so a source that has yet to place a
  // story is visibly at zero rather than missing from the table
  for (const f of feeds) {
    nameById.set(f.id, f.name);
    const s = get(f.name);
    if (f.added && (!s.added || f.added < s.added)) s.added = f.added;
  }

  for (const c of clusters) {
    const recent = c.links.filter((l) => hoursAgo(l.addedAt) <= WINDOW_DAYS * 24);
    if (recent.length === 0) continue;
    const clusterScore = score(c, cfg.ranking);
    const lead = leadLink(c);
    const seen = new Set<string>();
    for (const l of recent) {
      if (!nameById.has(l.sourceId)) nameById.set(l.sourceId, l.sourceName);
      const s = get(l.sourceName);
      s.items += 1;
      if (!seen.has(l.sourceName)) {
        seen.add(l.sourceName);
        s.stories += 1;
        s.points += clusterScore;
      }
    }
    if (recent.includes(lead)) get(lead.sourceName).leads += 1;
  }

  const rows = [...stats.values()].sort((a, b) => b.stories - a.stories || b.leads - a.leads);

  /**
   * Gate columns come from per-source daily counters, which only started when
   * the counters shipped. Passed and Considered are summed from the same day
   * buckets, so Inclusion is always Passed / Considered over exactly the days
   * that have gate data. Story counts span the full window and are NOT mixed
   * into that ratio, which is what made the earlier percentages nonsense.
   */
  const gate = (() => {
    const catByName = new Map(feeds.map((f) => [f.name, f.category ?? ""]));
    const windowStart = utcDay(new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60000).toISOString());
    // gate counters live per feed id, so same-name feeds sum into one total
    const totals = new Map<string, { considered: number; passed: number }>();
    const daysWithData = new Set<string>();
    for (const [sourceId, days] of Object.entries(state.sourceStats ?? {})) {
      const name = nameById.get(sourceId);
      if (!name) continue;
      const t = totals.get(name) ?? { considered: 0, passed: 0 };
      totals.set(name, t);
      for (const [day, bucket] of Object.entries(days)) {
        if (day < windowStart) continue;
        t.considered += bucket.considered;
        t.passed += bucket.accepted;
        if (bucket.considered > 0) daysWithData.add(day);
      }
    }
    const sorted = [...daysWithData].sort();
    return {
      firstDay: sorted[0],
      dayCount: sorted.length,
      rows: rows.map((r) => {
        const t = totals.get(r.name) ?? { considered: 0, passed: 0 };
        return {
          ...r,
          category: catByName.get(r.name) ?? "",
          avg: r.stories > 0 ? r.points / r.stories : 0,
          considered: t.considered,
          passed: t.passed,
          inclusion: t.considered > 0 ? (t.passed / t.considered) * 100 : -1,
        };
      }),
    };
  })();

  return (
    <main className="wrap page single admin">
      <div>
        <h1>Source Leaderboard</h1>
        <p className="status-line">
          Last {WINDOW_DAYS} days · admin-only preview · <Link href="/admin">back to admin</Link>
        </p>
        <p className="status-line">🔒 columns expose internal scoring and must stay admin-only if this page ever goes public.</p>
        <p className="status-line">
          {gate.firstDay
            ? `Considered, Passed, and Inclusion cover the ${gate.dayCount} day${gate.dayCount === 1 ? "" : "s"} of gate data since ${gate.firstDay}. Stories, Leads, and Links cover the full ${WINDOW_DAYS} days, so do not read them against the inclusion rate.`
            : "No gate data recorded yet, so Considered, Passed, and Inclusion stay empty until the next pipeline run."}
        </p>
        {rows.length === 0 ? (
          <p className="empty-state">No sources configured.</p>
        ) : (
          <LeaderboardTable rows={gate.rows} />
        )}
      </div>
    </main>
  );
}
