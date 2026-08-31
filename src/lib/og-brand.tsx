import { ImageResponse } from "next/og";
import { ogFonts } from "./og";
import { siteIdentity } from "./site";

export const OG_SIZE = { width: 1200, height: 630 };

/**
 * The generic brand card for utility pages (subscribe, verify, archive…):
 * wordmark, the page's name, one line on what the page is for. Without
 * these, such pages inherit the root card and preview unrelated headlines.
 */
export function brandCard(title: string, subtitle: string, pathSuffix: string) {
  const site = siteIdentity();
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
          fontFamily: "Selawik",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-end", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 46, fontWeight: 700, lineHeight: 1 }}>{site.siteName}</div>
          <div style={{ display: "flex", fontSize: 26, color: "#858b96", lineHeight: 1, marginBottom: 4 }}>
            {site.tagline}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", margin: "auto 0", paddingBottom: 40 }}>
          <div style={{ display: "flex", fontSize: 72, fontWeight: 700, lineHeight: 1.1 }}>{title}</div>
          <div style={{ display: "flex", fontSize: 32, color: "#b8bcc4", marginTop: 18, lineHeight: 1.4, maxWidth: 900 }}>
            {subtitle}
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 24, color: "#858b96" }}>
          {site.domain}/{pathSuffix}
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: ogFonts() }
  );
}
