"use client";

import type { DayMetrics } from "@/lib/metrics";
import { AdminChrome, type AdminChromeData } from "../shared";

export interface DistributionData {
  /** newest first, up to 14 days */
  days: DayMetrics[];
  /** clicked cluster ids resolved to headlines (aged-out ids resolve to themselves) */
  stories: Record<string, { headline: string; slug?: string }>;
}

function sumMaps(days: DayMetrics[], pick: (d: DayMetrics) => Record<string, number>): Array<[string, number]> {
  const totals: Record<string, number> = {};
  for (const d of days) {
    for (const [k, v] of Object.entries(pick(d))) totals[k] = (totals[k] ?? 0) + v;
  }
  return Object.entries(totals).sort((a, b) => b[1] - a[1]);
}

export function DistributionClient({ chrome, data }: { chrome: AdminChromeData; data: DistributionData }) {
  const { days } = data;

  // per-reader rollup: max subs today and across the window, last seen
  const readers: Record<string, { today: number; window: number; hits: number; lastSeen: string }> = {};
  for (const d of days) {
    for (const [name, r] of Object.entries(d.feed.readers)) {
      const cur = readers[name] ?? { today: 0, window: 0, hits: 0, lastSeen: "" };
      cur.window = Math.max(cur.window, r.subs);
      if (d === days[0]) cur.today = r.subs;
      cur.hits += r.hits;
      if (r.lastSeen > cur.lastSeen) cur.lastSeen = r.lastSeen;
      readers[name] = cur;
    }
  }
  const readerRows = Object.entries(readers).sort((a, b) => b[1].window - a[1].window);
  const toolTotals = sumMaps(days, (d) => d.mcp.tools);
  const clientTotals = sumMaps(days, (d) => d.mcp.clients);
  const storyTotals = sumMaps(days, (d) => d.clicks.stories).slice(0, 20);
  const domainTotals = sumMaps(days, (d) => d.clicks.domains).slice(0, 20);
  const sponsoredTotal = days.reduce((n, d) => n + d.clicks.sponsored, 0);
  const mcpHtmlTotal = days.reduce((n, d) => n + d.mcp.htmlViews, 0);
  const mcpInitTotal = days.reduce((n, d) => n + d.mcp.initializes, 0);

  return (
    <div>
      <AdminChrome chrome={chrome} />

      {days.length === 0 ? (
        <p className="empty-state">No distribution metrics recorded yet. Counters start filling in as the feed, the MCP server, and story links get traffic.</p>
      ) : null}

      <h2 id="feed">RSS feed</h2>
      <div className="admin-card">
        <div className="headline">Requests by day</div>
        <div className="sub">
          Hits count CDN misses only (the feed is cached five minutes at the edge). The subscriber column below is the
          real audience number: readers report it themselves in their User-Agent.
        </div>
        {days.map((d) => (
          <div key={d.date} className="sub" style={{ margin: "4px 0" }}>
            {d.date} · {d.feed.hits} hit{d.feed.hits === 1 ? "" : "s"}
          </div>
        ))}
      </div>
      {readerRows.length > 0 ? (
        <div className="admin-card">
          <div className="headline">Feed readers</div>
          {readerRows.map(([name, r]) => (
            <div key={name} className="sub" style={{ margin: "4px 0" }}>
              <strong>{name}</strong> · {r.window > 0 ? `${r.window} subscribers` : "no subscriber count reported"}
              {r.today > 0 && r.today !== r.window ? ` (${r.today} today)` : ""} · {r.hits} fetches · last seen{" "}
              {r.lastSeen ? new Date(r.lastSeen).toUTCString().replace("GMT", "UTC") : "unknown"}
            </div>
          ))}
        </div>
      ) : null}

      <h2 id="mcp">MCP server</h2>
      <div className="admin-card">
        <div className="headline">Tool calls, last {days.length} day{days.length === 1 ? "" : "s"}</div>
        {toolTotals.length === 0 ? <div className="sub">No tool calls recorded yet.</div> : null}
        {toolTotals.map(([tool, n]) => (
          <div key={tool} className="sub" style={{ margin: "4px 0" }}>
            <strong>{tool}</strong> · {n}
          </div>
        ))}
        <div className="sub" style={{ marginTop: 8 }}>
          {mcpInitTotal} session{mcpInitTotal === 1 ? "" : "s"} (the server is stateless, so every client connection
          re-initializes) · {mcpHtmlTotal} browser visit{mcpHtmlTotal === 1 ? "" : "s"} to the explainer page
        </div>
      </div>
      {clientTotals.length > 0 ? (
        <div className="admin-card">
          <div className="headline">Clients</div>
          {clientTotals.map(([name, n]) => (
            <div key={name} className="sub" style={{ margin: "4px 0" }}>
              <strong>{name}</strong> · {n} session{n === 1 ? "" : "s"}
            </div>
          ))}
        </div>
      ) : null}

      <h2 id="clicks">Outbound story clicks</h2>
      <div className="admin-card">
        <div className="headline">Clicks by day</div>
        {days.map((d) => (
          <div key={d.date} className="sub" style={{ margin: "4px 0" }}>
            {d.date} · {d.clicks.total} click{d.clicks.total === 1 ? "" : "s"}
          </div>
        ))}
        {sponsoredTotal > 0 ? (
          <div className="sub" style={{ marginTop: 8 }}>
            {sponsoredTotal} sponsored click{sponsoredTotal === 1 ? "" : "s"} in the window
          </div>
        ) : null}
      </div>
      {storyTotals.length > 0 ? (
        <div className="admin-card">
          <div className="headline">Most clicked stories</div>
          {storyTotals.map(([id, n]) => {
            const s = data.stories[id] ?? { headline: id };
            return (
              <div key={id} className="sub" style={{ margin: "4px 0" }}>
                {s.slug ? <a href={`/story/${s.slug}`}>{s.headline}</a> : s.headline} · {n}
              </div>
            );
          })}
        </div>
      ) : null}
      {domainTotals.length > 0 ? (
        <div className="admin-card">
          <div className="headline">Most clicked destinations</div>
          {domainTotals.map(([domain, n]) => (
            <div key={domain} className="sub" style={{ margin: "4px 0" }}>
              <strong>{domain}</strong> · {n}
            </div>
          ))}
        </div>
      ) : null}

      <p className="status-line">
        This page covers the consumption side (feed, MCP, outbound clicks). Inbound attribution per channel lives in
        Vercel Analytics and Google Analytics under utm_source x, farcaster, and email.
      </p>
    </div>
  );
}
