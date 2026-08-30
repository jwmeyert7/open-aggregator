import Link from "next/link";
import { Pixelify_Sans } from "next/font/google";
import { WordmapCloud } from "./WordmapCloud";
import { NotLoggedIn } from "../server";
import { isAdmin } from "@/lib/auth";
import { loadDailyDigest, loadMonthlyDigest, loadState, loadWeeklyDigest, loadYearlyDigest } from "@/lib/state";
import { monthLabel, subjectRangeLabel } from "@/lib/digest";
import { navSections } from "@/lib/config";
import { siteIdentity } from "@/lib/site";
import { editionTexts, extractWords, layoutCloud, wordmapColors, wordmapStats, WORDMAP_H, WORDMAP_W, type WordmapSiteConfig } from "@/lib/wordmap";
import type { CSSProperties } from "react";

type WordmapKind = "day" | "week" | "month" | "year";

/** The cloud's blocky face; the PNG route bundles the same family's TTFs. */
const pixel = Pixelify_Sans({ subsets: ["latin"], variable: "--font-pixel" });

/**
 * "The news on August 26, 2026" for a day, "The news, August 22-28, 2026"
 * for a week, "The news in August 2026" for a month, "The news in 2026"
 * for a year.
 */
function wordmapTitle(kind: WordmapKind, digest: { start?: string; end?: string } | null, picked: string): string {
  if (kind === "week" && digest?.start && digest?.end) {
    return `The news, ${subjectRangeLabel(new Date(`${digest.start}T00:00:00Z`), new Date(`${digest.end}T00:00:00Z`))}`;
  }
  if (kind === "month") return `The news in ${monthLabel(picked)}`;
  if (kind === "year") return `The news in ${picked}`;
  const label = new Date(`${picked}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return `The news on ${label}`;
}

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin · Word maps", robots: { index: false } };

/**
 * Admin-only preview of the word map idea: one map per daily, weekly,
 * monthly, or yearly edition (frozen or in progress), deterministic per
 * date. The central term comes from the edition's top story and everything
 * radiates from it, section colors form spatial neighborhoods, every word
 * links its story, and each map offers its two generated PNGs (light and
 * dark).
 */
export default async function WordmapPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; date?: string }>;
}) {
  if (!(await isAdmin())) return <NotLoggedIn />;
  const { kind: rawKind, date } = await searchParams;
  const state = await loadState();
  const lists: Record<WordmapKind, string[]> = {
    day: state.dailyDigestDates ?? [],
    week: state.weeklyDigestDates ?? [],
    month: state.monthlyDigestMonths ?? [],
    year: state.yearlyDigestYears ?? [],
  };

  const kind: WordmapKind = rawKind === "week" || rawKind === "month" || rawKind === "year" ? rawKind : "day";
  const picked = date ?? lists[kind][0];
  const digest = picked
    ? kind === "week"
      ? await loadWeeklyDigest(picked)
      : kind === "month"
        ? await loadMonthlyDigest(picked)
        : kind === "year"
          ? await loadYearlyDigest(picked)
          : await loadDailyDigest(picked)
    : null;

  const site: WordmapSiteConfig = {
    sections: navSections().map((s) => s.id),
    extraStop: siteIdentity().topic.toLowerCase().split(/[^a-z0-9]+/),
  };
  const words = digest ? extractWords(editionTexts(digest), site) : [];
  const topHref = digest?.clusters[0] ? `/story/${digest.clusters[0].slug}` : undefined;
  const storyRanks = new Map((digest?.clusters ?? []).map((c, i) => [`/story/${c.slug}`, i]));
  const cloud = digest ? layoutCloud(words, `${kind}-${picked}`, site.sections, topHref, storyRanks) : [];
  const stats = wordmapStats(words, site.sections);
  const colors = { light: wordmapColors("light", site.sections), dark: wordmapColors("dark", site.sections) };

  const navRows: Array<{ label: string; kind: WordmapKind; short: (v: string) => string; empty: string }> = [
    { label: "Days", kind: "day", short: (v) => v.slice(5), empty: "" },
    { label: "Weeks", kind: "week", short: (v) => `wk-${v.slice(5)}`, empty: "none yet (the first freezes Saturday)" },
    { label: "Months", kind: "month", short: (v) => v, empty: "none yet (the first freezes on the 1st)" },
    { label: "Years", kind: "year", short: (v) => v, empty: "none yet (the first freezes January 1)" },
  ];

  return (
    <main className="wrap page single admin">
      <div>
        <p className="sub">
          <Link href="/admin">Admin</Link> · Word maps (admin-only preview of the word map / collectible editions idea)
        </p>
        <h2>Word maps</h2>
        {navRows.map((row) => (
          <div className="wordmap-nav" key={row.kind}>
            <span className="sub">{row.label}:</span>
            {lists[row.kind].length === 0 && row.empty ? <span className="sub">{row.empty}</span> : null}
            {lists[row.kind].map((d) => (
              <Link
                key={d}
                href={`/admin/wordmap?kind=${row.kind}&date=${d}`}
                className={kind === row.kind && d === picked ? "current" : ""}
              >
                {row.short(d)}
              </Link>
            ))}
          </div>
        ))}
        {digest ? (
          <>
            <div className={`wordmap-card ${pixel.variable}`}>
              <div className="wordmap-title">
                <div className="wordmap-title-main">
                  {/* the title walks to the edition it maps */}
                  <Link href={`/${kind}/${picked}`} title="Open this edition's archive page">
                    {wordmapTitle(kind, kind === "week" ? (digest as { start?: string; end?: string }) : null, picked)}
                  </Link>
                </div>
                <div className="wordmap-title-sub">{siteIdentity().siteName}</div>
              </div>
              <WordmapCloud cloud={cloud} canvas={{ w: WORDMAP_W, h: WORDMAP_H }} colors={colors} />
            </div>
            {"inProgress" in digest && digest.inProgress ? (
              <p className="sub">
                <span className="live-dot" aria-hidden="true" />
                This edition is still in progress, so this map keeps changing until the freeze.
              </p>
            ) : null}
            <p className="sub">
              Images:{" "}
              <a href={`/admin/wordmap/image?kind=${kind}&date=${picked}&theme=light`} rel="noopener">
                light PNG
              </a>{" "}
              ·{" "}
              <a href={`/admin/wordmap/image?kind=${kind}&date=${picked}&theme=dark`} rel="noopener">
                dark PNG
              </a>
              . Hover any word to light up its whole story. The central term comes from the edition&apos;s top story.
            </p>
            <h3>Distribution</h3>
            <table className="leaderboard wordmap-stats">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Words</th>
                  <th>Stories</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.section}>
                    <td
                      className="wm-sec"
                      style={
                        {
                          "--wm-light": colors.light[s.section] ?? colors.light.general,
                          "--wm-dark": colors.dark[s.section] ?? colors.dark.general,
                        } as CSSProperties
                      }
                    >
                      <span className="wm-dot" aria-hidden="true" />
                      {s.section}
                    </td>
                    <td>
                      {s.words} ({s.wordPct}%)
                    </td>
                    <td>
                      {s.stories} ({s.storyPct}%)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>Top words</h3>
            <p className="sub">
              Weighted counts (headlines ×3, also-in-the-news and podcast titles ×2, explainers and coverage titles
              ×1). Curation notes welcome: words to stop-list, weights to change.
            </p>
            <p className="sub">{words.map((w) => `${w.text} (${w.weight})`).join(" · ")}</p>
          </>
        ) : (
          <p className="empty-state">No edition for that date yet.</p>
        )}
      </div>
    </main>
  );
}
