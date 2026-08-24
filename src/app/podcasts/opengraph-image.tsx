import { ImageResponse } from "next/og";
import { siteIdentity } from "@/lib/site";
import { loadSiteConfig } from "@/lib/config";
import { adaptiveRanking, rankMedia } from "@/lib/rank";
import { loadState } from "@/lib/state";
import { formatViews } from "@/lib/util";

export const dynamic = "force-dynamic";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Podcasts preview";

/**
 * The podcasts page's own social card: the week's most watched episodes, so
 * a pasted /podcasts link previews the shelf itself instead of inheriting
 * the front page's story card.
 */
export default async function Image() {
  const site = siteIdentity();
  let entries: Array<{ title: string; sub: string }> = [];
  try {
    const state = await loadState();
    const cfg = loadSiteConfig();
    entries = rankMedia((state.mediaItems ?? []).filter((m) => !m.hidden), state, adaptiveRanking(state, cfg.ranking))
      .slice(0, 4)
      .map((m) => ({
        title: m.displayTitle ?? m.title,
        sub: `${m.sourceName}${formatViews(m.views) ? ` · ${formatViews(m.views)} views` : ""}`,
      }));
  } catch {
    // a blob hiccup must not break link previews; the card renders headerless
  }

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
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-end", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 46, fontWeight: 700, lineHeight: 1 }}>{site.siteName}</div>
          <div style={{ display: "flex", fontSize: 26, color: "#858b96", lineHeight: 1, marginBottom: 4 }}>
            {site.tagline}
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 34, color: "#b8bcc4", marginTop: 14 }}>
          Podcasts · most watched this week
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 32, gap: 20 }}>
          {entries.map((e, i) => (
            <div key={i} style={{ display: "flex", position: "relative", paddingLeft: 48 }}>
              <div style={{ display: "flex", position: "absolute", left: 0, top: 0, color: "#8b8ff0", fontWeight: 700, lineHeight: 1.3 }}>
                {i + 1}.
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", lineHeight: 1.3 }}>
                  {e.title.length > 62 ? `${e.title.slice(0, 61)}…` : e.title}
                </div>
                <div style={{ display: "flex", color: "#858b96", fontSize: 22, marginTop: 4 }}>/ {e.sub}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", marginTop: "auto", fontSize: 24, color: "#858b96" }}>/podcasts</div>
      </div>
    ),
    size
  );
}
