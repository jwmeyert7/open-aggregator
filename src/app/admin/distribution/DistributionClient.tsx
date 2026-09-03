"use client";

import { useState } from "react";
import type { DayMetrics } from "@/lib/metrics";
import type { RedditPostRecord } from "@/lib/types";
import { AdminChrome, call, Toast, useAdminAct, type AdminChromeData } from "../shared";

export interface DistributionData {
  /** newest first, up to 14 days */
  days: DayMetrics[];
  /** clicked cluster ids resolved to headlines (aged-out ids resolve to themselves) */
  stories: Record<string, { headline: string; slug?: string }>;
  reddit: {
    configured: boolean;
    enabled: boolean;
    subreddit: string;
    postHourUtc: number;
    posts: RedditPostRecord[];
    lastAttemptAt: string | null;
  };
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
  const { busy, status, setStatus, act } = useAdminAct();
  const [preview, setPreview] = useState("");

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
  const searchTotal = days.reduce((n, d) => n + (d.searches?.total ?? 0), 0);
  const queryTotals = sumMaps(days, (d) => d.searches?.queries ?? {}).slice(0, 40);
  const missTotals = sumMaps(days, (d) => d.searches?.misses ?? {}).slice(0, 20);
  const mcpHtmlTotal = days.reduce((n, d) => n + d.mcp.htmlViews, 0);
  const mcpInitTotal = days.reduce((n, d) => n + d.mcp.initializes, 0);

  return (
    <div>
      <AdminChrome chrome={chrome} />
      <Toast status={status} onClear={() => setStatus("")} />

      <h2 id="reddit">Reddit daily comment</h2>
      <div className="admin-card">
        <div className="headline">
          r/{data.reddit.subreddit} daily thread ·{" "}
          {!data.reddit.enabled || !data.reddit.subreddit
            ? "off in config"
            : data.reddit.configured
              ? `posting automatically after ${String(data.reddit.postHourUtc).padStart(2, "0")}:00 UTC`
              : "no credentials yet, runs dry"}
        </div>
        <div className="sub">
          Yesterday&apos;s frozen edition goes in as one comment, top stories with site and source links, where the
          thread&apos;s regulars and any mod roundup can pick it up. Credentials live in Vercel env (REDDIT_CLIENT_ID,
          REDDIT_CLIENT_SECRET, REDDIT_REFRESH_TOKEN). Mint the refresh token once at{" "}
          <a href="/api/admin/reddit-auth">/api/admin/reddit-auth</a>.
          {data.reddit.lastAttemptAt ? ` Last attempt ${data.reddit.lastAttemptAt.slice(0, 16).replace("T", " ")} UTC.` : ""}
        </div>
        <div className="form-row">
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              const r = (await call("previewReddit")) as { ok: boolean; message?: string; text?: string };
              setStatus(r.message ?? (r.ok ? "Done." : "Failed."));
              setPreview(r.text ?? "");
            }}
          >
            Preview comment
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => act("postReddit", {}, "Post yesterday's edition into the daily thread now?")}
          >
            Post now
          </button>
        </div>
        {preview ? <pre className="reddit-preview">{preview}</pre> : null}
        {data.reddit.posts.length > 0 ? (
          <ul className="search-items">
            {data.reddit.posts.map((p) => (
              <li key={p.postedAt} className="newest-item">
                {p.commentUrl ? <a href={p.commentUrl}>edition {p.date}</a> : <span>edition {p.date}</span>}
                <div className="org">
                  posted {p.postedAt.slice(0, 16).replace("T", " ")} UTC{p.manual ? " · by hand" : ""}
                  {p.threadUrl ? (
                    <>
                      {" · "}
                      <a href={p.threadUrl}>thread</a>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="sub">No comments made yet.</div>
        )}
      </div>

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

      <h2 id="search">Site search</h2>
      <div className="admin-card">
        <div className="headline">
          {searchTotal} search{searchTotal === 1 ? "" : "es"} in the window
        </div>
        <div className="sub">
          What readers typed into the search box, your own searches excluded. Misses are queries that found no story
          and no stream item, the clearest signal of a source or a story the site is missing.
        </div>
        {days.map((d) => (
          <div key={d.date} className="sub" style={{ margin: "4px 0" }}>
            {d.date} · {d.searches?.total ?? 0}
          </div>
        ))}
      </div>
      {queryTotals.length > 0 ? (
        <div className="admin-card">
          <div className="headline">Most searched</div>
          {queryTotals.map(([q, n]) => (
            <div key={q} className="sub" style={{ margin: "4px 0" }}>
              <a href={`/search?q=${encodeURIComponent(q)}`}>{q}</a> · {n}
            </div>
          ))}
        </div>
      ) : null}
      {missTotals.length > 0 ? (
        <div className="admin-card">
          <div className="headline">Searches that found nothing</div>
          {missTotals.map(([q, n]) => (
            <div key={q} className="sub" style={{ margin: "4px 0" }}>
              <a href={`/search?q=${encodeURIComponent(q)}`}>{q}</a> · {n}
            </div>
          ))}
        </div>
      ) : null}

      <p className="status-line">
        This page covers the consumption side (feed, MCP, outbound clicks, site search). Inbound attribution per channel lives in
        Vercel Analytics and Google Analytics under utm_source x, farcaster, reddit, and email.
      </p>
    </div>
  );
}
