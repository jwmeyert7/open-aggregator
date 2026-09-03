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
  email: {
    /** oldest first, 14 days */
    signups: Array<{ date: string; all: number; confirmed: number }>;
    total: number;
    unconfirmed: number;
    daily: number;
    weekly: number;
    monthly: number;
  };
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

/**
 * One bar per day, oldest left, for a 14 day metric. A second series draws
 * inside the first as a darker bar (sessions inside tool calls, misses
 * inside searches), the same idiom as the email growth bars.
 */
function DayBars({
  days,
  value,
  inner,
  label,
  innerLabel,
}: {
  days: DayMetrics[];
  value: (d: DayMetrics) => number;
  inner?: (d: DayMetrics) => number;
  label: string;
  innerLabel?: string;
}) {
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const max = Math.max(1, ...ordered.map(value));
  return (
    <div className="email-growth day-bars">
      {ordered.map((d) => {
        const v = value(d);
        const i = inner ? inner(d) : 0;
        return (
          <div
            key={d.date}
            className="email-growth-col"
            title={`${d.date}: ${v} ${label}${inner ? `, ${i} ${innerLabel ?? ""}` : ""}`}
          >
            <div className="email-growth-bar">
              <div className="all" style={{ height: `${(v / max) * 48}px` }} />
              {inner ? <div className="conf" style={{ height: `${(i / max) * 48}px` }} /> : null}
            </div>
            <div className="email-growth-label">{d.date.slice(5)}</div>
            <div className="email-growth-label">{v}</div>
          </div>
        );
      })}
    </div>
  );
}

/** The comment's Reddit markdown as HTML, close to how Reddit shows it: bold, links, numbered lists, paragraphs. */
function redditHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>')
      .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" rel="noopener">$2</a>');
  const out: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length > 0) out.push(`<ol>${list.map((l) => `<li>${l}</li>`).join("")}</ol>`);
    list = [];
  };
  for (const line of md.split("\n")) {
    const m = /^\d+\.\s+(.*)$/.exec(line);
    if (m) list.push(inline(m[1]));
    else {
      flush();
      if (line.trim()) out.push(`<p>${inline(line)}</p>`);
    }
  }
  flush();
  return out.join("");
}

export function DistributionClient({ chrome, data }: { chrome: AdminChromeData; data: DistributionData }) {
  const { days } = data;
  const { busy, status, setStatus, act } = useAdminAct();
  const [preview, setPreview] = useState("");
  const [previewRaw, setPreviewRaw] = useState(false);

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

      <h2 id="email">Email</h2>
      <div className="admin-card">
        <div className="headline">
          {data.email.total} confirmed subscriber{data.email.total === 1 ? "" : "s"} · {data.email.daily} daily / {data.email.weekly} weekly /{" "}
          {data.email.monthly} monthly
          {data.email.unconfirmed > 0 ? ` · ${data.email.unconfirmed} unconfirmed` : ""}
        </div>
        <div className="sub">
          Signups per day, confirmed as the darker bar. The list itself, sends, and previews live on{" "}
          <a href="/admin/email">Email</a>.
        </div>
        <div className="email-growth day-bars">
          {(() => {
            const max = Math.max(1, ...data.email.signups.map((d) => d.all));
            return data.email.signups.map((d) => (
              <div key={d.date} className="email-growth-col" title={`${d.date}: ${d.all} signup${d.all === 1 ? "" : "s"}, ${d.confirmed} confirmed`}>
                <div className="email-growth-bar">
                  <div className="all" style={{ height: `${(d.all / max) * 48}px` }} />
                  <div className="conf" style={{ height: `${(d.confirmed / max) * 48}px` }} />
                </div>
                <div className="email-growth-label">{d.date.slice(5)}</div>
                <div className="email-growth-label">{d.all}</div>
              </div>
            ));
          })()}
        </div>
      </div>

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
        {preview ? (
          <>
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button type="button" className={`filter-chip${previewRaw ? "" : " on"}`} onClick={() => setPreviewRaw(false)}>
                as Reddit shows it
              </button>
              <button type="button" className={`filter-chip${previewRaw ? " on" : ""}`} onClick={() => setPreviewRaw(true)}>
                markdown
              </button>
            </div>
            {previewRaw ? (
              <pre className="reddit-preview">{preview}</pre>
            ) : (
              <div className="reddit-preview reddit-rendered" dangerouslySetInnerHTML={{ __html: redditHtml(preview) }} />
            )}
          </>
        ) : null}
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
        <DayBars days={days} value={(d) => d.feed.hits} label="hits" />
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
        <div className="headline">By day</div>
        <div className="sub">Tool calls per day, with sessions (client connections) as the darker bar inside.</div>
        <DayBars
          days={days}
          value={(d) => Object.values(d.mcp.tools).reduce((n, v) => n + v, 0)}
          inner={(d) => d.mcp.initializes}
          label="tool calls"
          innerLabel="sessions"
        />
      </div>
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
        <div className="sub">Sponsored clicks as the darker bar inside.</div>
        <DayBars days={days} value={(d) => d.clicks.total} inner={(d) => d.clicks.sponsored} label="clicks" innerLabel="sponsored" />
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
        <DayBars
          days={days}
          value={(d) => d.searches?.total ?? 0}
          inner={(d) => Object.values(d.searches?.misses ?? {}).reduce((n, v) => n + v, 0)}
          label="searches"
          innerLabel="found nothing"
        />
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
