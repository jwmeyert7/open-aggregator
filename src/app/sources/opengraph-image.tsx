import { ImageResponse } from "next/og";
import { siteIdentity } from "@/lib/site";
import { effectiveFeeds } from "@/lib/config";
import { isMediaFeed } from "@/lib/feeds";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Sources preview";

/**
 * The sources page's own social card: the whitelist in numbers, so a pasted
 * /sources link previews what the page is about instead of inheriting the
 * front page's story card.
 */
export default async function Image() {
  const site = siteIdentity();
  let news = 0;
  let shows = 0;
  let showNames = "";
  try {
    const feeds = effectiveFeeds(await loadState());
    const newsNames = new Set(feeds.filter((f) => !isMediaFeed(f)).map((f) => f.name));
    const showSet = new Set(feeds.filter((f) => isMediaFeed(f)).map((f) => f.name));
    news = newsNames.size;
    shows = showSet.size;
    showNames = [...showSet].slice(0, 6).join(", ");
  } catch {
    // a blob hiccup must not break link previews; the card renders with zeros
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
        <div style={{ display: "flex", fontSize: 34, color: "#b8bcc4", marginTop: 14 }}>Sources</div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 36, gap: 24 }}>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700 }}>{news} hand-picked news sources</div>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700 }}>{shows} podcast shows</div>
          {showNames ? (
            <div style={{ display: "flex", color: "#858b96", fontSize: 24, lineHeight: 1.4 }}>
              {showNames}, and more
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", marginTop: "auto", fontSize: 24, color: "#858b96" }}>/sources</div>
      </div>
    ),
    size
  );
}
