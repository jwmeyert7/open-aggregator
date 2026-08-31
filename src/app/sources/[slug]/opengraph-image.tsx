import { ImageResponse } from "next/og";
import { effectiveFeeds } from "@/lib/config";
import { isMediaFeed } from "@/lib/feeds";
import { ogFonts, ogTruncate } from "@/lib/og";
import { liveClusters } from "@/lib/rank";
import { siteIdentity } from "@/lib/site";
import { loadState } from "@/lib/state";
import { sourceSlug } from "../shared";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Source page preview";

/**
 * Social card for a source page: the source's name over its most recent
 * items on the site, so a shared /sources link previews the source itself
 * instead of falling back to the generic front-page card.
 */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const state = await loadState();
  const site = siteIdentity();
  const named = effectiveFeeds(state).filter((f) => sourceSlug(f.name) === slug);
  const feed = named[0];

  // recent items: article links from live stories, or a pure show's episodes
  const items: Array<{ title: string; when: string }> = [];
  if (feed) {
    if (named.some((f) => !isMediaFeed(f))) {
      const seen = new Set<string>();
      for (const c of liveClusters(state)) {
        if (c.mergedInto) continue;
        for (const l of c.links) {
          if (l.sourceName !== feed.name || seen.has(l.url)) continue;
          seen.add(l.url);
          items.push({ title: l.title, when: l.publishedAt });
        }
      }
    } else {
      for (const m of state.mediaItems ?? []) {
        if (!m.hidden && m.sourceName === feed.name) items.push({ title: m.displayTitle ?? m.title, when: m.publishedAt });
      }
    }
  }
  const recent = items.sort((a, b) => b.when.localeCompare(a.when)).slice(0, 4);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#15171b",
          color: "#e8e8e4",
          padding: "56px 64px",
          fontSize: 30,
          fontFamily: "Selawik",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-end", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 46, fontWeight: 700, lineHeight: 1 }}>{site.siteName}</div>
          <div style={{ display: "flex", fontSize: 26, color: "#858b96", lineHeight: 1, marginBottom: 4 }}>
            {site.tagline}
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 54, fontWeight: 700, marginTop: 40, lineHeight: 1.1 }}>
          {feed?.name ?? "Sources"}
        </div>
        <div style={{ display: "flex", fontSize: 27, color: "#b8bcc4", marginTop: 10 }}>
          {feed ? `Everything from ${feed.name} that's on ${site.siteName}` : `The whitelist ${site.siteName} reads`}
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 34, gap: 18 }}>
          {recent.map((e, i) => (
            <div key={i} style={{ display: "flex", position: "relative", paddingLeft: 36, lineHeight: 1.3, fontSize: 28 }}>
              <div style={{ display: "flex", position: "absolute", left: 0, top: 0, color: "#8b8ff0", fontWeight: 700 }}>
                ·
              </div>
              {ogTruncate(e.title, 66)}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", marginTop: "auto", fontSize: 24, color: "#858b96" }}>
          {site.domain}/sources/{slug}
        </div>
      </div>
    ),
    { ...size, fonts: ogFonts() }
  );
}
