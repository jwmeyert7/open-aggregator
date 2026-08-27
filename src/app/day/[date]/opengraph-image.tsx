import { ImageResponse } from "next/og";
import { ogFonts, ogTruncate } from "@/lib/og";
import { siteIdentity } from "@/lib/site";
import { leadLink } from "@/lib/rank";
import { loadDailyDigest } from "@/lib/state";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Daily front page preview";

function dateLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Farcaster/social embed card: a real preview of the day's digest. */
export default async function Image({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const digest = await loadDailyDigest(date);
  const site = siteIdentity();
  const entries = (digest?.clusters ?? []).slice(0, 4).map((c) => ({
    headline: c.headline,
    source: leadLink(c)?.sourceName ?? "",
  }));

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
        <div style={{ display: "flex", fontSize: 34, color: "#b8bcc4", marginTop: 14 }}>{dateLabel(date)}</div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 32,
            gap: 20,
          }}
        >
          {entries.map((e, i) => (
            // the rank is absolutely positioned so its glyph width can never
            // shift the headline: every headline starts at exactly the same x
            // (flex-based ranks aligned differently in Satori locally vs on
            // Vercel, so alignment must not depend on flex at all)
            <div key={i} style={{ display: "flex", position: "relative", paddingLeft: 48 }}>
              <div style={{ display: "flex", position: "absolute", left: 0, top: 0, color: "#8b8ff0", fontWeight: 700, lineHeight: 1.3 }}>
                {i + 1}.
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {/* 62 chars keeps one line, cut at a word boundary, never mid-word */}
                <div style={{ display: "flex", lineHeight: 1.3 }}>{ogTruncate(e.headline, 62)}</div>
                {e.source ? (
                  <div style={{ display: "flex", color: "#858b96", fontSize: 22, marginTop: 4 }}>/ {e.source}</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", marginTop: "auto", fontSize: 24, color: "#858b96" }}>
          {site.domain}/day/{date}
        </div>
      </div>
    ),
    { ...size, fonts: ogFonts() }
  );
}
