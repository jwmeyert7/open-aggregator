import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { isAdmin } from "@/lib/auth";
import { ogFonts } from "@/lib/og";
import { loadDailyDigest, loadMonthlyDigest, loadWeeklyDigest, loadYearlyDigest } from "@/lib/state";
import { monthLabel, subjectRangeLabel } from "@/lib/digest";
import {
  editionTexts,
  extractWords,
  layoutCloud,
  wordBox,
  wordFontWeight,
  WORDMAP_H,
  WORDMAP_PALETTES,
  WORDMAP_W,
  wordmapColors,
  type WordmapSiteConfig,
} from "@/lib/wordmap";
import { navSections } from "@/lib/config";
import { siteIdentity } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * The word map as a PNG, in either palette: the two images each edition's
 * admin page links (the future mint artwork). Admin-only like the page.
 */
export async function GET(req: NextRequest) {
  if (!(await isAdmin())) return new Response("Not found", { status: 404 });
  const sp = req.nextUrl.searchParams;
  const rawKind = sp.get("kind");
  const kind = rawKind === "week" || rawKind === "month" || rawKind === "year" ? rawKind : "day";
  const date = sp.get("date") ?? "";
  const theme = sp.get("theme") === "light" ? "light" : "dark";
  const digest =
    kind === "week"
      ? await loadWeeklyDigest(date)
      : kind === "month"
        ? await loadMonthlyDigest(date)
        : kind === "year"
          ? await loadYearlyDigest(date)
          : await loadDailyDigest(date);
  if (!digest) return new Response("No edition", { status: 404 });

  const site: WordmapSiteConfig = {
    sections: navSections().map((s) => s.id),
    extraStop: siteIdentity().topic.toLowerCase().split(/[^a-z0-9]+/),
  };
  const words = extractWords(editionTexts(digest), site);
  const topHref = digest.clusters[0] ? `/story/${digest.clusters[0].slug}` : undefined;
  const storyRanks = new Map(digest.clusters.map((c, i) => [`/story/${c.slug}`, i]));
  const cloud = layoutCloud(words, `${kind}-${date}`, site.sections, topHref, storyRanks);
  const pal = WORDMAP_PALETTES[theme];
  const colors = wordmapColors(theme, site.sections);
  const title =
    kind === "week" && "start" in digest
      ? `The news, ${subjectRangeLabel(new Date(`${digest.start}T00:00:00Z`), new Date(`${digest.end}T00:00:00Z`))}`
      : kind === "month"
        ? `The news in ${monthLabel(date)}`
        : kind === "year"
          ? `The news in ${date}`
          : `The news on ${new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" })}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          backgroundColor: pal.bg,
          fontFamily: "Selawik",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 36, top: 26 }}>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 700, color: pal.title }}>{title}</div>
          <div style={{ display: "flex", fontSize: 19, color: pal.brand, marginTop: 4 }}>{siteIdentity().siteName}</div>
        </div>
        {cloud.map((w) => {
          const box = wordBox(w.text, w.size);
          return (
            <div
              key={w.text}
              style={{
                display: "flex",
                position: "absolute",
                left: Math.round(w.x - box.w / 2),
                top: Math.round(w.y - box.h / 2),
                fontSize: w.size,
                lineHeight: 1.05,
                fontWeight: wordFontWeight(w.size),
                color: colors[w.section] ?? colors.general,
                whiteSpace: "nowrap",
              }}
            >
              {w.text}
            </div>
          );
        })}
      </div>
    ),
    { width: WORDMAP_W, height: WORDMAP_H, fonts: ogFonts() }
  );
}
