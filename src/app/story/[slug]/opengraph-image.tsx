import { ImageResponse } from "next/og";
import { navSections } from "@/lib/config";
import { ogFonts, ogTruncate } from "@/lib/og";
import { siteIdentity } from "@/lib/site";
import { leadLink } from "@/lib/rank";
import { loadState } from "@/lib/state";
import type { Cluster, SiteState } from "@/lib/types";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Story preview";

function findCluster(state: SiteState, slug: string): Cluster | undefined {
  const direct = Object.values(state.clusters).find((c) => c.slug === slug);
  if (direct) return direct;
  const id = slug.split("-").pop();
  return id ? state.clusters[id] : undefined;
}

/** A greeked text line: reads as text at a glance, says nothing up close. */
function Bar({ w, h = 10, c = "#3d414b", mt = 0 }: { w: number; h?: number; c?: string; mt?: number }) {
  return <div style={{ display: "flex", width: w, height: h, backgroundColor: c, borderRadius: h / 2, marginTop: mt }} />;
}

/**
 * A stale or mistyped story link renders a miniature of the desktop front
 * page instead of an error card: real chrome (wordmark, tabs, column labels),
 * greeked story text, the three-column shape with the podcasts box in the
 * middle, exactly the layout a visitor lands on.
 */
function genericCard() {
  const site = siteIdentity();
  const sections = navSections();
  const MUTED = "#262932";
  const story = (kickerW: number, l1: number, l2: number) => (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <Bar w={kickerW} h={9} c={MUTED} />
      <Bar w={l1} h={15} mt={9} />
      <Bar w={l2} h={15} mt={7} />
      <Bar w={l2 * 0.8} h={9} c={MUTED} mt={9} />
    </div>
  );
  const episode = (t1: number, t2: number) => (
    <div style={{ display: "flex", gap: 12 }}>
      <div style={{ display: "flex", width: 84, height: 48, backgroundColor: MUTED, borderRadius: 6 }} />
      <div style={{ display: "flex", flexDirection: "column", marginTop: 4 }}>
        <Bar w={t1} h={11} />
        <Bar w={t2} h={9} c={MUTED} mt={8} />
      </div>
    </div>
  );
  const newestRow = (t1: number, t2: number) => (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <Bar w={t1} h={10} />
      <Bar w={t2} h={8} c={MUTED} mt={6} />
    </div>
  );
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: "#0c0d10",
          padding: 44,
          fontFamily: "Selawik",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            backgroundColor: "#15171b",
            border: "1px solid #2b2e35",
            borderRadius: 14,
            padding: "30px 40px",
            color: "#e8e8e4",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-end", gap: 16 }}>
            <div style={{ display: "flex", fontSize: 38, fontWeight: 700, lineHeight: 1 }}>{site.siteName}</div>
            <div style={{ display: "flex", fontSize: 22, color: "#858b96", lineHeight: 1, marginBottom: 3 }}>
              {site.tagline}
            </div>
            <div
              style={{
                display: "flex",
                marginLeft: "auto",
                fontSize: 18,
                color: "#6b707a",
                border: "1px solid #2b2e35",
                borderRadius: 8,
                padding: "6px 40px 6px 14px",
              }}
            >
              Search
            </div>
          </div>
          <div style={{ display: "flex", gap: 26, marginTop: 24, fontSize: 21, color: "#858b96" }}>
            <div style={{ display: "flex", color: "#e8e8e4", fontWeight: 600, borderBottom: "2px solid #e8e8e4", paddingBottom: 6 }}>
              Top Stories
            </div>
            {sections.map((s) => (
              <div key={s.id} style={{ display: "flex" }}>{s.title}</div>
            ))}
            <div style={{ display: "flex" }}>New</div>
            <div style={{ display: "flex" }}>Podcasts</div>
          </div>
          <div style={{ display: "flex", gap: 44, marginTop: 28, flexGrow: 1 }}>
            <div style={{ display: "flex", flexDirection: "column", width: 430, gap: 24 }}>
              {story(74, 410, 330)}
              {story(96, 380, 415)}
              {story(60, 425, 300)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", width: 300, gap: 16 }}>
              <div style={{ display: "flex", fontSize: 16, letterSpacing: 2, color: "#6b707a" }}>PODCASTS</div>
              {episode(180, 130)}
              {episode(150, 165)}
              {episode(190, 120)}
              {episode(140, 155)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, gap: 15 }}>
              <div style={{ display: "flex", fontSize: 16, letterSpacing: 2, color: "#6b707a" }}>NEWEST</div>
              {newestRow(235, 150)}
              {newestRow(200, 170)}
              {newestRow(250, 130)}
              {newestRow(215, 160)}
              {newestRow(240, 145)}
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 20, color: "#858b96" }}>{site.domain}</div>
        </div>
      </div>
    ),
    { ...size, fonts: ogFonts() }
  );
}

/** Social embed card for a story permalink: headline, explainer, lead source. */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const state = await loadState();
  const cluster = findCluster(state, slug);
  if (!cluster || cluster.killed) return genericCard();

  const headline = cluster.headline;
  const explainer = cluster.explainer ? cluster.explainer.charAt(0).toUpperCase() + cluster.explainer.slice(1) : "";
  const source = leadLink(cluster)?.sourceName ?? "";
  const section = cluster.section;

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
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700, lineHeight: 1 }}>{site.siteName}</div>
          <div style={{ display: "flex", fontSize: 24, color: "#858b96", lineHeight: 1, marginBottom: 3 }}>
            {site.tagline}
          </div>
          {section ? (
            <div
              style={{
                display: "flex",
                marginLeft: "auto",
                fontSize: 22,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: "#8b8ff0",
                lineHeight: 1,
                marginBottom: 3,
              }}
            >
              {section}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", fontSize: 52, fontWeight: 700, lineHeight: 1.2, marginTop: 46 }}>
          {ogTruncate(headline, 120)}
        </div>
        {explainer ? (
          <div style={{ display: "flex", fontSize: 28, color: "#b8bcc4", lineHeight: 1.4, marginTop: 26 }}>
            {ogTruncate(explainer, 180)}
          </div>
        ) : null}
        {source ? (
          <div style={{ display: "flex", fontSize: 26, color: "#858b96", marginTop: 22 }}>/ {source}</div>
        ) : null}
        <div style={{ display: "flex", marginTop: "auto", fontSize: 24, color: "#858b96" }}>{site.domain}</div>
      </div>
    ),
    { ...size, fonts: ogFonts() }
  );
}
