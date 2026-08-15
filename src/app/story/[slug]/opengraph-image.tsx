import { ImageResponse } from "next/og";
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

/** Social embed card for a story permalink: headline, explainer, lead source. */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const state = await loadState();
  const cluster = findCluster(state, slug);

  const headline = cluster && !cluster.killed ? cluster.headline : "Story not found";
  const explainer =
    cluster && !cluster.killed && cluster.explainer
      ? cluster.explainer.charAt(0).toUpperCase() + cluster.explainer.slice(1)
      : "";
  const source = cluster && !cluster.killed ? (leadLink(cluster)?.sourceName ?? "") : "";
  const section = cluster && !cluster.killed ? cluster.section : "";

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
          {headline.length > 120 ? `${headline.slice(0, 119)}…` : headline}
        </div>
        {explainer ? (
          <div style={{ display: "flex", fontSize: 28, color: "#b8bcc4", lineHeight: 1.4, marginTop: 26 }}>
            {explainer.length > 180 ? `${explainer.slice(0, 179)}…` : explainer}
          </div>
        ) : null}
        {source ? (
          <div style={{ display: "flex", fontSize: 26, color: "#858b96", marginTop: 22 }}>/ {source}</div>
        ) : null}
        <div style={{ display: "flex", marginTop: "auto", fontSize: 24, color: "#858b96" }}>{site.domain}</div>
      </div>
    ),
    size
  );
}
