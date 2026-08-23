"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ScoreBreakdown } from "@/lib/rank";
import type { Listing, MediaItem, RunLogEntry, SourceCandidate, SponsoredPost } from "@/lib/types";
import { timeAgo } from "@/lib/util";

export interface AdminData {
  sections: string[];
  clusters: Array<{
    id: string;
    headline: string;
    explainer: string;
    section: string;
    alsoIn?: string;
    slug: string;
    score: number;
    breakdown: ScoreBreakdown;
    createdAt: string;
    editHistory: Array<{ at: string; kind: string; before: string; after: string }>;
    topRank: number | null;
    sectionRank: number | null;
    farcasterUrl: string | null;
    links: number;
    linkList: Array<{ url: string; sourceName: string; title: string }>;
    leadUrl: string | null;
    pinned: boolean;
    needsReview: boolean;
    postedX: boolean;
    postedFarcaster: boolean;
  }>;
  xMonthly: { used: number; cap: number };
  submissions: Array<{
    id: string;
    url: string;
    note?: string;
    email?: string;
    storyHeadline?: string;
    storySlug?: string;
    newSource: boolean;
    at: string;
  }>;
  unhealthyFeeds: Array<{ name: string; reason: string }>;
  sources: Array<{
    id: string;
    name: string;
    url: string;
    tier: 1 | 2;
    weight: number;
    category: string;
    custom: boolean;
    disabled: boolean;
    health: string;
  }>;
  sourceCandidates: SourceCandidate[];
  markets: Array<{
    slug: string;
    label: string;
    section: string;
    custom: boolean;
    disabled: boolean;
    prob: number | null;
    url: string;
    resolved: boolean;
    lastSwingAt: string | null;
  }>;
  marketCfg: { threshold: number; cooldownHours: number; minLiquidity: number } | null;
  sponsorPageEnabled: boolean;
  layout: {
    preview: "weekday" | "weekend" | null;
    scheduled: "weekday" | "weekend";
    schedule: { startDow: number; startHour: number; endDow: number; endHour: number };
    custom: boolean;
  };
  jobs: Listing[];
  events: Listing[];
  podcasts: Listing[];
  mediaItems: MediaItem[];
  announcement: { text: string; url?: string; hidden?: boolean } | null;
  sponsoredPosts: SponsoredPost[];
  subscribers: { daily: number; weekly: number };
  emailSubscribers: Array<{ email: string; daily: boolean; weekly: boolean; confirmed: boolean; addedAt: string }>;
  riverCount: number;
  updatedAt: string;
  runs: RunLogEntry[];
  digests: Array<{ date: string; stories: number; cast: boolean; tweetId: string | null }>;
}

const SOURCE_CATEGORIES = [
  "team",
  "forum",
  "individual",
  "research",
  "newsletter",
  "news",
  "news - mainstream",
  "discovery",
  "other",
];

const ADMIN_SECTIONS = ["stories", "add-url", "submissions", "candidates", "sources", "markets", "media", "runs", "layout", "email", "announcement", "sponsored", "jobs", "events", "podcasts"];

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

async function call(action: string, payload: Record<string, unknown> = {}) {
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res
    .json()
    .catch(() => ({ ok: false, message: `Server returned ${res.status} with an unreadable body.` }));
  return json as { ok: boolean; message?: string };
}

export function AdminClient({
  authed,
  data,
  initialFilter = "",
}: {
  authed: boolean;
  data: AdminData | null;
  initialFilter?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [storyQuery, setStoryQuery] = useState(initialFilter);
  const [showAllStories, setShowAllStories] = useState(false);
  const [showAllRuns, setShowAllRuns] = useState(false);
  const [activeSection, setActiveSection] = useState("stories");
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    function onScroll() {
      // active section = the one whose heading sits nearest above the sticky
      // menu; falls back to the topmost heading when none has passed it yet
      let current: string | null = null;
      let bestAbove = -Infinity;
      let firstBelow = Infinity;
      let firstBelowId: string | null = null;
      for (const id of ADMIN_SECTIONS) {
        const el = document.getElementById(id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        // generous threshold: mobile browser chrome shifts anchor targets a
        // few px past the nominal scroll-margin, which used to mis-highlight
        if (top <= 200 && top > bestAbove) {
          bestAbove = top;
          current = id;
        }
        if (top > 200 && top < firstBelow) {
          firstBelow = top;
          firstBelowId = id;
        }
      }
      setActiveSection(current ?? firstBelowId ?? ADMIN_SECTIONS[0]);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!authed) return;
    // mint/refresh the cosmetic footer-link marker on every authed admin
    // visit, so sessions predating the marker pick it up without re-login
    document.cookie =
      "oa_admin_ui=1; path=/; max-age=31536000; samesite=lax" +
      (location.protocol === "https:" ? "; secure" : "");
  }, [authed]);

  async function act(action: string, payload: Record<string, unknown> = {}, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setStatus("Working…");
    const res = await call(action, payload);
    setStatus(res.message || (res.ok ? "Done." : "Failed."));
    setBusy(false);
    if (res.ok) router.refresh();
  }

  if (!authed || !data) {
    return (
      <div>
        <h1>Admin</h1>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const password = new FormData(e.currentTarget).get("password") as string;
            const res = await call("login", { password });
            setStatus(res.message || "");
            if (res.ok) router.refresh();
          }}
        >
          <div className="form-row">
            <input className="text" type="password" name="password" placeholder="Admin password" autoFocus />
            <button className="btn primary" type="submit">
              Log in
            </button>
          </div>
        </form>
        <p className="status-line">{status}</p>
      </div>
    );
  }

  const navLink = (id: string, label: string) => (
    <a
      href={`#${id}`}
      className={activeSection === id ? "active" : ""}
      onClick={(e) => {
        // the site-wide smooth scroll is for readers; admin jumps teleport
        e.preventDefault();
        document.getElementById(id)?.scrollIntoView({ behavior: "instant", block: "start" });
        history.replaceState(null, "", `#${id}`);
        setActiveSection(id);
      }}
    >
      {label}
    </a>
  );

  return (
    <div>
      <div className="admin-head">
        <h1>Admin</h1>
        <nav className="admin-nav">
          {navLink("stories", "Stories")}
          {navLink("add-url", "Add by URL")}
          {navLink("submissions", data.submissions.length > 0 ? `Submissions (${data.submissions.length})` : "Submissions")}
          {navLink("candidates", data.sourceCandidates.length > 0 ? `Candidates (${data.sourceCandidates.length})` : "Candidates")}
          {navLink("sources", "Sources")}
          {navLink("markets", "Markets")}
          {navLink("media", "Podcasts")}
          {navLink("runs", "Runs")}
          {navLink("layout", "Layout")}
          {navLink("email", "Email")}
          {navLink("announcement", "Announcement")}
          <span className="admin-nav-group">
            <span className="group-label">Sponsored:</span>
            {navLink("sponsored", "Posts")}
            {navLink("jobs", "Jobs")}
            {navLink("events", "Events")}
            {navLink("podcasts", "Sponsored Podcasts")}
          </span>
          <a href="/admin/leaderboard">Leaderboard</a>
          <a href="/admin/farcaster">Farcaster</a>
        </nav>
      </div>
      <p className="status-line">
        Stream: {data.riverCount} items · X this month: {data.xMonthly.used}/{data.xMonthly.cap} · email subs:{" "}
        {data.subscribers.daily} daily / {data.subscribers.weekly} weekly · state updated{" "}
        {new Date(data.updatedAt).toUTCString().replace("GMT", "UTC")} ·{" "}
        <button className="btn" disabled={busy} onClick={() => act("runPipeline")}>
          Run pipeline now
        </button>{" "}
        <button className="btn" disabled={busy} onClick={() => act("logout")}>
          Log out
        </button>
      </p>
      {status ? (
        <div className="notice toast" onClick={() => setStatus("")} title="Dismiss">
          {status}
        </div>
      ) : null}

      {data.unhealthyFeeds.length > 0 ? (
        <div className="notice">
          <strong>Feed health:</strong>{" "}
          {data.unhealthyFeeds.map((f) => (
            <span key={f.name} className="health-bad">
              {f.name} ({f.reason}){" "}
            </span>
          ))}
        </div>
      ) : null}

      <h2 id="stories">Stories</h2>
      <div className="form-row">
        <input
          className="text"
          placeholder="Filter stories by headline, section, or source…"
          value={storyQuery}
          onChange={(e) => setStoryQuery(e.target.value)}
        />
      </div>
      {(() => {
        const q = storyQuery.trim().toLowerCase();
        const filtered = q
          ? data.clusters.filter(
              (c) =>
                c.headline.toLowerCase().includes(q) ||
                c.section === q ||
                c.linkList.some((l) => l.sourceName.toLowerCase().includes(q))
            )
          : data.clusters;
        const shown = showAllStories || q ? filtered : filtered.slice(0, 15);
        return (
          <>
            {shown.map((c) => (
        <div key={c.id} className="admin-card">
          <div className="headline">
            {c.pinned ? "📌 " : ""}
            {c.headline}
          </div>
          {c.explainer ? (
            <div className="sub" style={{ fontStyle: "italic", margin: "2px 0 4px" }}>
              What this means: {c.explainer}
            </div>
          ) : null}
          <div className="sub">
            {c.section} ·{" "}
            <details className="score-detail">
              <summary>score {c.score}</summary>
              <span className="score-math">
                <span className="score-line">
                  <strong>Coverage:</strong> {c.breakdown.uniqueSources} source
                  {c.breakdown.uniqueSources === 1 ? "" : "s"} contributing {c.breakdown.sourceWeight.toFixed(1)} raw
                  weight, {c.breakdown.decayedSourceWeight.toFixed(2)} after age. Each link&apos;s weight halves every{" "}
                  {c.breakdown.decayHalfLifeHours}h from its own publish time, so a late follow-up adds fresh weight
                  without resurrecting old links (newest coverage {Math.round(c.breakdown.freshestAgeHours)}h ago).
                </span>
                <span className="score-line">
                  <strong>Velocity:</strong> {c.breakdown.velocityLinks} link
                  {c.breakdown.velocityLinks === 1 ? "" : "s"} arrived in the last 6h, adding{" "}
                  {(c.breakdown.velocityLinks * c.breakdown.velocityBoostPerLink).toFixed(2)}. A story gathering
                  coverage right now surges.
                </span>
                <span className="score-line">
                  <strong>Importance:</strong> the editor rated it {c.breakdown.importance}/5
                  {c.breakdown.importanceCapped ? ", capped to 2 (single uncorroborated forum source)" : ""}, multiplying
                  the score by {c.breakdown.importanceFactor.toFixed(2)}. Routine items sink, ecosystem-defining ones
                  rise.
                </span>
                <span className="score-line">
                  <strong>Topic centrality:</strong> rated {c.breakdown.centrality}/5 for how specifically this is
                  about the site&apos;s topic, multiplying by {c.breakdown.centralityFactor.toFixed(2)}. On-topic
                  stories outrank tangential ones.
                </span>
                {c.breakdown.forumFactor !== 1 ? (
                  <span className="score-line">
                    <strong>Corroboration:</strong> the only source is an open forum, so the score rides at ×
                    {c.breakdown.forumFactor.toFixed(2)} until a second source joins.
                  </span>
                ) : null}
                <span className="score-line">
                  <strong>Total:</strong> (
                  <span title="Coverage: source weight after per-link age decay">
                    {c.breakdown.decayedSourceWeight.toFixed(2)}
                  </span>{" "}
                  + <span title="Velocity: bonus from links in the last 6h">
                    {(c.breakdown.velocityLinks * c.breakdown.velocityBoostPerLink).toFixed(2)}
                  </span>
                  ) × <span title="Importance multiplier (editor's 1-5 rating)">{c.breakdown.importanceFactor.toFixed(2)}</span> ×{" "}
                  <span title="Topic centrality multiplier (how specifically about the site's topic)">
                    {c.breakdown.centralityFactor.toFixed(2)}
                  </span>{" "}
                  {c.breakdown.forumFactor !== 1 ? (
                    <>
                      × <span title="Single open-forum source (provisional until corroborated)">{c.breakdown.forumFactor.toFixed(2)}</span>{" "}
                    </>
                  ) : null}
                  = <strong>{c.breakdown.total.toFixed(2)}</strong>
                </span>
              </span>
            </details>
            {" · "}
            <span title={new Date(c.createdAt).toUTCString().replace("GMT", "UTC")}>
              created {timeAgo(c.createdAt)}
            </span>
            {c.sectionRank ? ` · #${c.sectionRank} in ${c.section}` : ""}
            {c.topRank ? ` · #${c.topRank} in top stories` : ""}
            {" · "}
            {c.links} link{c.links === 1 ? "" : "s"}
            {" · "}
            {[...new Set(c.linkList.map((l) => l.sourceName))].join(", ")}
            {c.needsReview ? " · ⚠ needs review (created without LLM)" : ""}
            {c.postedX ? " · posted to X" : ""}
            {c.postedFarcaster ? (
              <>
                {" · "}
                {c.farcasterUrl ? (
                  <a href={c.farcasterUrl} rel="noopener">
                    posted to Farcaster ↗
                  </a>
                ) : (
                  <span title="The bot processed this story before real credentials existed: nothing was actually sent to Farcaster, and the bot won't post it later.">
                    bot skipped (pre-launch rehearsal)
                  </span>
                )}
              </>
            ) : null}{" "}
            · <a href={`/story/${c.slug}`}>view</a>
          </div>
          <div className="btn-row">
            <button className="btn" disabled={busy} onClick={() => act("pin", { clusterId: c.id })}>
              {c.pinned ? "Unpin" : "Pin"}
            </button>
            <button
              className="btn danger"
              disabled={busy}
              onClick={() => act("kill", { clusterId: c.id }, `Kill “${c.headline}”?`)}
            >
              Kill
            </button>
            <select
              className="select"
              style={{ width: "auto" }}
              value={c.section}
              disabled={busy}
              onChange={(e) => act("resection", { clusterId: c.id, section: e.target.value })}
            >
              {/* general is a valid section for roundups but not a nav section */}
              {[...data.sections, "general"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              className="select"
              style={{ width: "auto" }}
              value={c.alsoIn ?? ""}
              disabled={busy}
              title="A second section label, for the rare story that belongs to two"
              onChange={(e) => act("resection", { clusterId: c.id, alsoIn: e.target.value })}
            >
              <option value="">also in…</option>
              {data.sections
                .filter((s) => s !== c.section)
                .map((s) => (
                  <option key={s} value={s}>
                    also in {s}
                  </option>
                ))}
            </select>
            <select
              className="select"
              style={{ width: "auto" }}
              value=""
              disabled={busy}
              onChange={(e) => {
                if (e.target.value)
                  act("merge", { clusterId: c.id, targetId: e.target.value }, "Merge this story into the selected one?");
              }}
            >
              <option value="">Merge into…</option>
              {data.clusters
                .filter((o) => o.id !== c.id)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.headline.slice(0, 60)}
                  </option>
                ))}
            </select>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                const headline = window.prompt("Headline:", c.headline);
                if (headline === null) return;
                const explainer = window.prompt("What this means (one sentence):", c.explainer);
                if (explainer === null) return;
                act("edit", { clusterId: c.id, headline, explainer });
              }}
            >
              Edit
            </button>
            <button
              className="btn"
              disabled={busy || c.postedX}
              onClick={() =>
                act("postX", { clusterId: c.id }, `Post to X now? (${data.xMonthly.used}/${data.xMonthly.cap} used this month)`)
              }
            >
              Post to X
            </button>
            <button
              className="btn"
              disabled={busy}
              title="Re-run the current editorial rules over this story's links (headline, explainer, section, importance)"
              onClick={() => act("reedit", { clusterId: c.id }, `Re-edit “${c.headline}” with the current rules?`)}
            >
              Re-edit
            </button>
          </div>
          {/* editor override: attach coverage straight onto this story, skipping
              the editorial gate (which judges standalone stories, not angles) */}
          <form
            className="form-row attach-row"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const url = String(f.get("url") ?? "").trim();
              if (!url) return;
              act("attachLink", { clusterId: c.id, url, as: String(f.get("as") ?? "auto") });
              e.currentTarget.reset();
            }}
          >
            <input className="text" name="url" placeholder="Attach a link to this story (no gate)…" />
            <select
              className="text"
              name="as"
              defaultValue="auto"
              title="auto lets tier and weight decide the kicker, lead pins this link as the kicker, coverage pins the current lead so this link can never take over"
            >
              <option value="auto">auto</option>
              <option value="lead">as lead</option>
              <option value="coverage">as coverage</option>
            </select>
            <button className="btn" type="submit" disabled={busy}>
              Attach
            </button>
          </form>
          {c.editHistory.length > 0 ? (
            <details className="links-detail">
              <summary>edit history ({c.editHistory.length})</summary>
              {c.editHistory.map((e, i) => (
                <div key={i} className="sub" style={{ margin: "4px 0" }}>
                  {timeAgo(e.at)} · {e.kind}:{" "}
                  {e.before === e.after ? (
                    "headline unchanged"
                  ) : (
                    <>
                      “{e.before}” → <strong>“{e.after}”</strong>
                    </>
                  )}
                </div>
              ))}
            </details>
          ) : null}
          {c.linkList.length > 1 ? (
            <details className="links-detail">
              <summary>links ({c.links})</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const urls = new FormData(e.currentTarget).getAll("url").map(String);
                  if (urls.length === 0) return;
                  act(
                    "split",
                    { clusterId: c.id, urls },
                    `Split ${urls.length} link${urls.length === 1 ? "" : "s"} out of “${c.headline}” into a new story? Both stories get re-edited.`
                  );
                }}
              >
                {c.linkList.map((l) => (
                  <div key={l.url} className="link-row">
                    <label className="link-check">
                      <input type="checkbox" name="url" value={l.url} /> <span className="src">{l.sourceName}</span>:{" "}
                      {l.title}
                    </label>
                    <button
                      type="button"
                      className="btn lead-btn"
                      disabled={busy}
                      title={
                        c.leadUrl === l.url
                          ? "Pinned as the lead. Click to return to automatic."
                          : "Pin this link as the story's lead (the kicker source)"
                      }
                      onClick={() => act("setLead", { clusterId: c.id, url: c.leadUrl === l.url ? "" : l.url })}
                    >
                      {c.leadUrl === l.url ? "lead ✓" : "make lead"}
                    </button>
                  </div>
                ))}
                <div className="btn-row">
                  <button className="btn" type="submit" disabled={busy}>
                    Split selected into new story
                  </button>
                </div>
              </form>
            </details>
          ) : null}
        </div>
            ))}
            {filtered.length === 0 && data.clusters.length > 0 ? (
              <p className="empty-state">No stories match “{storyQuery}”.</p>
            ) : null}
            {!q && !showAllStories && filtered.length > 15 ? (
              <button className="btn" onClick={() => setShowAllStories(true)}>
                Show all {filtered.length} stories
              </button>
            ) : null}
          </>
        );
      })()}
      {data.clusters.length === 0 ? <p className="empty-state">No stories yet. Run the pipeline.</p> : null}

      <h2 id="add-url">Add story by URL</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const url = new FormData(e.currentTarget).get("url") as string;
          if (url) act("addUrl", { url });
          e.currentTarget.reset();
        }}
      >
        <div className="form-row">
          <input className="text" name="url" placeholder="Paste any link: article, tweet, forum post…" />
          <button className="btn primary" type="submit" disabled={busy}>
            Add
          </button>
        </div>
      </form>

      <h2 id="submissions">Submissions</h2>
      {data.submissions.length === 0 ? (
        <p className="status-line">
          No pending reader suggestions. Links suggested via /submit queue here (and email you). Approve attaches a
          story-targeted suggestion straight to its story, and runs the Add by URL editorial flow otherwise.
        </p>
      ) : null}
      {data.submissions.map((s) => (
        <div key={s.id} className="admin-card">
          <div className="headline">
            <a href={s.url} rel="noopener">
              {s.url.replace(/^https?:\/\/(www\.)?/, "")}
            </a>
            {s.newSource ? <span className="pill">new source</span> : null}
          </div>
          <div className="sub">
            {timeAgo(s.at)}
            {s.storyHeadline ? (
              <>
                {" · for story: "}
                <a href={`/story/${s.storySlug}`}>{s.storyHeadline}</a>
              </>
            ) : (
              " · suggested as a new story"
            )}
            {s.email ? ` · from ${s.email}` : ""}
          </div>
          {s.note ? <div className="sub">“{s.note}”</div> : null}
          <div className="btn-row">
            <button className="btn primary" disabled={busy} onClick={() => act("approveSubmission", { id: s.id })}>
              Approve
            </button>
            <button className="btn" disabled={busy} onClick={() => act("dismissSubmission", { id: s.id })}>
              Dismiss
            </button>
          </div>
        </div>
      ))}

      <h2 id="candidates">Source candidates</h2>
      <p className="status-line">
        Domains the configured Farcaster discovery channel keeps linking that none of our sources cover. Nothing here
        is published. Judge the examples, then Add the good ones: it finds the domain&apos;s feed (Discourse, RSS, or
        Atom) and adds it as a tier 2 source you can tune below. Domains with no findable feed still need the manual
        form.
      </p>
      {data.sourceCandidates.length === 0 ? (
        <p className="status-line">Nothing new yet. Candidates appear after the next pipeline run reads the channel.</p>
      ) : (
        <table className="leaderboard">
          <thead>
            <tr>
              <th>Domain</th>
              <th title="Distinct casts seen linking this domain">Casts</th>
              <th title="Likes plus replies across those casts">Engagement</th>
              <th title="Largest follower count among the accounts that linked it">Top reach</th>
              <th title="When the channel first pointed at this domain">First seen</th>
              <th title="One-time editor read: what the domain publishes">Editor&apos;s read</th>
              <th title="Where this domain's stories would mostly land">Sections</th>
              <th>Recent examples</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.sourceCandidates.map((c) => (
              <tr key={c.host}>
                <td>
                  <a href={`https://${c.host}`} rel="noopener nofollow">
                    {c.host}
                  </a>
                </td>
                <td>{c.casts}</td>
                <td>{c.engagement}</td>
                <td>{c.topReach.toLocaleString()}</td>
                <td className="candidate-sections">{c.firstSeen.slice(0, 10)}</td>
                <td className="candidate-read">
                  {c.assessment ? c.assessment.why : <span className="org">next pipeline run</span>}
                </td>
                <td className="candidate-sections">
                  {c.assessment ? c.assessment.sections.join(", ") : <span className="org">·</span>}
                </td>
                <td>
                  {c.examples.slice(0, 3).map((e) => (
                    <div key={e.url} className="candidate-example">
                      <a href={e.url} rel="noopener nofollow" title={e.text}>
                        {e.url.replace(/^https?:\/\//, "").slice(0, 60)}
                      </a>{" "}
                      <span className="org">@{e.author}</span>
                    </div>
                  ))}
                </td>
                <td>
                  <div className="btn-row">
                    <button
                      className="btn"
                      disabled={busy}
                      title="Find this domain's feed and add it as a tier 2 source"
                      onClick={() => act("addCandidate", { host: c.host })}
                    >
                      Add
                    </button>
                    <button className="btn" disabled={busy} onClick={() => act("dismissCandidate", { host: c.host })}>
                      Dismiss
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 id="sources">Sources</h2>
      <p className="status-line">
        Built-in sources come from config/feeds.json and can be disabled here. Sources you add live in site state and
        can be removed. Changes take effect on the next pipeline run.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          act("addFeed", {
            name: f.get("name"),
            url: f.get("url"),
            type: f.get("type"),
            tier: f.get("tier"),
            weight: f.get("weight"),
            sectionHint: f.get("sectionHint"),
          });
          e.currentTarget.reset();
        }}
      >
        <div className="form-row">
          <input className="text" name="name" placeholder="Source name" required />
          <input className="text" name="url" placeholder="Feed URL (RSS/Atom)" required />
          <select className="select" name="type" style={{ width: "auto" }}>
            <option value="rss">rss</option>
            <option value="discourse">discourse</option>
          </select>
          <select className="select" name="tier" style={{ width: "auto" }} title="Tier 1: trusted, passes through. Tier 2: strict LLM gate.">
            <option value="1">tier 1</option>
            <option value="2">tier 2</option>
          </select>
          <input className="text" name="weight" placeholder="Weight (0.1-5)" style={{ maxWidth: 110 }} />
          <select className="select" name="sectionHint" style={{ width: "auto" }}>
            <option value="">section hint…</option>
            {data.sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select className="select" name="category" style={{ width: "auto" }}>
            {SOURCE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button className="btn" type="submit" disabled={busy}>
            Add source
          </button>
        </div>
      </form>
      {/* groups come from the data too, so a category added in config never
          leaves its sources invisible here */}
      {[...new Set([...SOURCE_CATEGORIES, ...data.sources.map((s) => s.category)])]
        .filter((cat) => data.sources.some((s) => s.category === cat))
        .map((cat) => (
        <details key={cat} className="source-group">
          <summary>
            {cat} ({data.sources.filter((s) => s.category === cat).length})
          </summary>
          {data.sources
            .filter((s) => s.category === cat)
            .map((s) => (
              <div key={s.id} className="admin-card">
                <div className="headline">
                  {s.disabled ? "⏸ " : ""}
                  {s.name} {s.custom ? <span className="sub">(added by admin)</span> : null}
                </div>
                <div className="sub">
                  <span className={s.health === "ok" ? "health-ok" : s.health === "not yet polled" ? "" : "health-bad"}>
                    {s.health}
                  </span>{" "}
                  · <a href={s.url}>{s.url}</a>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    act("editFeed", { id: s.id, tier: f.get("tier"), weight: f.get("weight"), category: f.get("category") });
                  }}
                >
                  <div className="btn-row">
                    <select className="select" name="tier" defaultValue={String(s.tier)} style={{ width: "auto" }} title="Tier 1 passes through. Tier 2 goes through the LLM gate">
                      <option value="1">tier 1</option>
                      <option value="2">tier 2</option>
                    </select>
                    <input className="text" name="weight" defaultValue={s.weight} style={{ maxWidth: 90 }} title="Ranking weight (0.1-5)" />
                    <select className="select" name="category" defaultValue={s.category} style={{ width: "auto" }}>
                      {SOURCE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <button className="btn" type="submit" disabled={busy}>
                      Save
                    </button>
                    <button className="btn" type="button" disabled={busy} onClick={() => act("toggleFeed", { id: s.id })}>
                      {s.disabled ? "Enable" : "Disable"}
                    </button>
                    {s.custom ? (
                      <button
                        className="btn danger"
                        type="button"
                        disabled={busy}
                        onClick={() => act("removeFeed", { id: s.id }, `Remove source “${s.name}”?`)}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </form>
              </div>
            ))}
        </details>
      ))}

      <h2 id="markets">Markets</h2>
      <p className="status-line">
        Polymarket event markets watched for exceptional swings
        {data.marketCfg
          ? ` (house story at a ±${data.marketCfg.threshold}-point move in 24h on ≥$${data.marketCfg.minLiquidity.toLocaleString()} liquidity, ${data.marketCfg.cooldownHours}h cooldown per market)`
          : ""}
        . Built-in markets come from config/sections.json and can be disabled here; markets you add live in site state
        and can be removed. Event markets only, never pure price markets. Changes take effect on the next pipeline run;
        a slug that fails to resolve shows up in the run notes below.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          act("addMarket", { slug: f.get("slug"), label: f.get("label"), section: f.get("section") });
          e.currentTarget.reset();
        }}
      >
        <div className="form-row">
          <input className="text" name="slug" placeholder="Market URL or slug" required />
          <input
            className="text"
            name="label"
            placeholder="Headline subject, e.g. “the treaty being ratified in 2026”"
            required
          />
          <select className="select" name="section" style={{ width: "auto" }}>
            <option value="">section…</option>
            {data.sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button className="btn" type="submit" disabled={busy}>
            Add market
          </button>
        </div>
      </form>
      {data.markets.length === 0 ? (
        <p className="status-line">No markets configured.</p>
      ) : (
        data.markets.map((m) => (
          <div key={m.slug} className="admin-card">
            <div className="headline">
              {m.disabled ? "⏸ " : ""}
              {m.label} {m.custom ? <span className="sub">(added by admin)</span> : null}
            </div>
            <div className="sub">
              {m.prob !== null ? (
                <span className="health-ok">~{m.prob}% implied</span>
              ) : (
                <span>not yet polled</span>
              )}{" "}
              ·{" "}
              <a href={m.url} rel="noopener" title={m.resolved ? "The market's event page on Polymarket" : "Best-guess link: the market hasn't resolved via the API yet, so this may not land anywhere"}>
                {m.slug}
              </a>
              {m.resolved ? "" : " (unresolved)"} · {m.section}
              {m.lastSwingAt ? ` · last swing story ${timeAgo(m.lastSwingAt)}` : ""}
            </div>
            <div className="btn-row">
              <button className="btn" type="button" disabled={busy} onClick={() => act("toggleMarket", { slug: m.slug })}>
                {m.disabled ? "Enable" : "Disable"}
              </button>
              {m.custom ? (
                <button
                  className="btn danger"
                  type="button"
                  disabled={busy}
                  onClick={() => act("removeMarket", { slug: m.slug }, `Remove market “${m.label}”?`)}
                >
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        ))
      )}

      <h2 id="runs">Pipeline runs</h2>
      <div className="btn-row" style={{ marginBottom: 10 }}>
        <button className="btn primary" disabled={busy} onClick={() => act("runPipeline")}>
          Run pipeline now
        </button>
        <button className="btn" disabled={busy} onClick={() => act("refreshSummary")}>
          Refresh summary
        </button>
      </div>
      {data.digests.length > 0 ? (
        <div className="admin-card">
          <div className="headline">Daily digests</div>
          {data.digests.map((d) => (
            <div key={d.date} className="sub" style={{ margin: "4px 0" }}>
              <a href={`/day/${d.date}`}>{d.date}</a> · {d.stories} stories · cast {d.cast ? "posted" : "missing"} · X{" "}
              {d.tweetId ? (
                <a href={`https://x.com/i/web/status/${d.tweetId}`} rel="noopener">
                  posted
                </a>
              ) : (
                <>
                  missing{" "}
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => act("tweetDigest", { date: d.date }, `Tweet the ${d.date} digest to X now?`)}
                  >
                    Tweet now
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      ) : null}
      {data.runs.length === 0 ? <p className="empty-state">No runs recorded yet.</p> : null}
      {(showAllRuns ? data.runs : data.runs.slice(0, 5)).map((r) => (
        <div key={r.at} className="admin-card">
          <div className="headline">
            {new Date(r.at).toUTCString().replace("GMT", "UTC")} <span className="sub">· {(r.ms / 1000).toFixed(1)}s</span>
          </div>
          <div className="sub">
            {r.newItems} new item{r.newItems === 1 ? "" : "s"} · {r.rejected} rejected by gate · {r.clustersCreated} new
            {" / "}
            {r.clustersUpdated} updated stories · LLM {r.usedLlm ? "used" : "not used"}
            {r.snapshot ? ` · snapshot ${r.snapshot}` : ""}
            {r.posted.length > 0 ? ` · posted: ${r.posted.join(", ")}` : ""}
          </div>
          {r.feedErrors.length > 0 ? (
            <div className="sub health-bad">
              feed errors: {r.feedErrors.map((e) => `${e.feedId} (${e.error.split("\n")[0]})`).join(", ")}
            </div>
          ) : null}
          {r.notes.length > 0 ? <div className="sub">{r.notes.join(" · ")}</div> : null}
          {r.rejectedSamples && r.rejectedSamples.length > 0 ? (
            <details className="links-detail">
              <summary>rejected samples ({r.rejectedSamples.length})</summary>
              {r.rejectedSamples.map((s, i) => (
                <div key={i} className="sub" style={{ margin: "4px 0" }}>
                  <strong>{s.source}</strong>: {s.title}
                  <br />↳ {s.reason}
                </div>
              ))}
            </details>
          ) : null}
        </div>
      ))}
      {!showAllRuns && data.runs.length > 5 ? (
        <button className="btn" onClick={() => setShowAllRuns(true)}>
          Show all {data.runs.length} runs
        </button>
      ) : null}

      <h2 id="layout">Layout</h2>
      <p className="status-line">
        Visitors see the <strong>{data.layout.scheduled}</strong> layout right now.
        {data.layout.preview
          ? ` You are previewing the ${data.layout.preview} layout (this browser only).`
          : " No preview active: you see what visitors see."}
      </p>
      <div className="btn-row" style={{ marginBottom: 10 }}>
        <button className="btn" disabled={busy} onClick={() => act("setLayoutPreview", { mode: "weekday" })}>
          Preview weekday
        </button>
        <button className="btn" disabled={busy} onClick={() => act("setLayoutPreview", { mode: "weekend" })}>
          Preview weekend
        </button>
        <button
          className="btn"
          disabled={busy || !data.layout.preview}
          onClick={() => act("setLayoutPreview", { mode: "clear" })}
        >
          Clear preview
        </button>
        <a href="/" target="_blank" rel="noopener">
          Open front page ↗
        </a>
      </div>
      <p className="status-line">
        <label className="footer-pref" style={{ marginLeft: 0 }}>
          <input
            type="checkbox"
            checked={data.sponsorPageEnabled}
            disabled={busy}
            onChange={(e) => act("setSponsorPage", { enabled: e.target.checked })}
          />{" "}
          show the Sponsor page and its footer link
        </label>
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          act("setWeekendSchedule", {
            startDow: f.get("startDow"),
            startHour: f.get("startHour"),
            endDow: f.get("endDow"),
            endHour: f.get("endHour"),
          });
        }}
      >
        <div className="form-row">
          <span className="sub">Weekend look runs from</span>
          <select className="select" name="startDow" defaultValue={String(data.layout.schedule.startDow)}>
            {DOW.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
          <select className="select" name="startHour" defaultValue={String(data.layout.schedule.startHour)}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
          <span className="sub">until</span>
          <select className="select" name="endDow" defaultValue={String(data.layout.schedule.endDow)}>
            {DOW.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
          <select className="select" name="endHour" defaultValue={String(data.layout.schedule.endHour)}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
          <span className="sub">UTC</span>
          <button className="btn primary" type="submit" disabled={busy}>
            Save window
          </button>
          {data.layout.custom ? (
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => act("setWeekendSchedule", { reset: true }, "Reset the weekend window to the built-in default?")}
            >
              Reset to default
            </button>
          ) : null}
        </div>
      </form>

      <h2 id="email">Email digests</h2>
      <p className="status-line">
        {data.emailSubscribers.length} subscriber{data.emailSubscribers.length === 1 ? "" : "s"} ·{" "}
        {data.subscribers.daily} daily / {data.subscribers.weekly} weekly. New signups receive nothing until they click
        their confirmation link.
      </p>
      <div className="btn-row" style={{ marginBottom: 10 }}>
        <button className="btn" disabled={busy} onClick={() => act("testDigestEmail", { kind: "daily" })}>
          Email me the latest daily
        </button>
        <button className="btn" disabled={busy} onClick={() => act("testDigestEmail", { kind: "weekly" })}>
          Email me the weekly
        </button>
      </div>
      {data.emailSubscribers.map((s) => (
        <div key={s.email} className="admin-card">
          <div className="sub">
            <strong>{s.email}</strong> · {[s.daily ? "daily" : null, s.weekly ? "weekly" : null].filter(Boolean).join(" + ")} ·{" "}
            {s.confirmed ? "confirmed" : <span className="health-bad">unconfirmed</span>} · joined {timeAgo(s.addedAt)}{" "}
            <button
              className="btn"
              disabled={busy}
              onClick={() => act("testDigestEmail", { kind: "daily", email: s.email }, `Send the latest daily edition to ${s.email}?`)}
            >
              Send daily
            </button>{" "}
            <button
              className="btn"
              disabled={busy}
              onClick={() => act("testDigestEmail", { kind: "weekly", email: s.email }, `Send the weekly edition to ${s.email}?`)}
            >
              Send weekly
            </button>{" "}
            {!s.confirmed ? (
              <button className="btn" disabled={busy} onClick={() => act("resendConfirmation", { email: s.email })}>
                Resend confirmation
              </button>
            ) : null}{" "}
            <button
              className="btn danger"
              disabled={busy}
              onClick={() => act("removeSubscriber", { email: s.email }, `Remove ${s.email} from the list?`)}
            >
              Remove
            </button>
          </div>
        </div>
      ))}

      <h2 id="announcement">Announcement slot</h2>
      <p className="status-line">
        {data.announcement?.text
          ? `${data.announcement.hidden ? "Saved but hidden" : "Currently live"}: “${data.announcement.text}”`
          : "Empty. Nothing renders on the site."}
        {data.announcement?.text ? (
          <>
            {" "}
            <label className="shown-check">
              <input
                type="checkbox"
                checked={!data.announcement.hidden}
                disabled={busy}
                onChange={() => act("toggleAnnouncement")}
              />{" "}
              shown
            </label>
          </>
        ) : null}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          act("setAnnouncement", { text: f.get("text"), url: f.get("url") });
        }}
      >
        <div className="form-row">
          <input className="text" name="text" placeholder="Announcement text" defaultValue={data.announcement?.text ?? ""} />
          <input className="text" name="url" placeholder="Link URL (optional)" defaultValue={data.announcement?.url ?? ""} />
          <button className="btn primary" type="submit" disabled={busy}>
            Save
          </button>
          <button
            className="btn danger"
            type="button"
            disabled={busy || !data.announcement}
            onClick={() => act("setAnnouncement", { text: "" }, "Clear the announcement and restore the placeholder?")}
          >
            Clear
          </button>
        </div>
      </form>

      <h2 id="sponsored">Sponsored posts</h2>
      <p className="status-line">
        The site shows the first “shown” post per placement. Extras can sit here hidden, queued for later.
      </p>
      {data.sponsoredPosts.map((p) => (
        <div key={p.id} className={`admin-card${p.hidden ? " is-hidden" : ""}`}>
          {editingId === p.id ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setEditingId(null);
                const placements = f.getAll("placements");
                act("editSponsored", {
                  id: p.id,
                  headline: f.get("headline"),
                  url: f.get("url"),
                  sponsor: f.get("sponsor"),
                  description: f.get("description"),
                  // the middle column shows everywhere, so it supersedes any mix
                  placements: placements.includes("sidebar") ? ["sidebar"] : placements,
                });
              }}
            >
              <div className="form-row">
                <input className="text" name="headline" defaultValue={p.headline} required />
                <input className="text" name="url" defaultValue={p.url} required />
                <input className="text" name="sponsor" defaultValue={p.sponsor ?? ""} placeholder="Sponsor name" />
                <input
                  className="text"
                  name="description"
                  defaultValue={p.description ?? ""}
                  placeholder="Description (reads like a story explainer)"
                  maxLength={280}
                />
                <span className="check-group">
                  {["top", ...data.sections, "sidebar"].map((s) => (
                    <label key={s} title={s === "sidebar" ? "Middle column, shows on every story page and overrides the others" : undefined}>
                      <input
                        type="checkbox"
                        name="placements"
                        value={s}
                        defaultChecked={(p.placements ?? [p.placement ?? "top"]).includes(s as never)}
                      />{" "}
                      {s === "top" ? "top stories" : s === "sidebar" ? "middle column" : s}
                    </label>
                  ))}
                </span>
                <button className="btn primary" type="submit" disabled={busy}>
                  Save
                </button>
                <button className="btn" type="button" onClick={() => setEditingId(null)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="headline">{p.headline}</div>
              {p.description ? (
                <div className="sub" style={{ fontStyle: "italic", margin: "2px 0 4px" }}>
                  {p.description}
                </div>
              ) : null}
              <div className="sub">
                {(p.placements ?? [p.placement ?? "top"]).join(", ")} {p.sponsor ? `· ${p.sponsor}` : ""} ·{" "}
                <a href={p.url}>{p.url}</a>
              </div>
              <div className="btn-row">
                <label className="shown-check">
                  <input
                    type="checkbox"
                    checked={!p.hidden}
                    disabled={busy}
                    onChange={() => act("toggleShown", { kind: "sponsoredPosts", id: p.id })}
                  />{" "}
                  shown
                </label>
                <button className="btn" disabled={busy} onClick={() => setEditingId(p.id)}>
                  Edit
                </button>
                <button className="btn danger" disabled={busy} onClick={() => act("removeSponsored", { id: p.id }, `Remove “${p.headline}”?`)}>
                  Remove
                </button>
              </div>
            </>
          )}
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const placements = f.getAll("placements");
          act("addSponsored", {
            headline: f.get("headline"),
            url: f.get("url"),
            sponsor: f.get("sponsor"),
            description: f.get("description"),
            placements: placements.includes("sidebar") ? ["sidebar"] : placements,
          });
          e.currentTarget.reset();
        }}
      >
        <div className="form-row">
          <input className="text" name="headline" placeholder="Headline" required />
          <input className="text" name="url" placeholder="URL" required />
          <input className="text" name="sponsor" placeholder="Sponsor name" />
          <input className="text" name="description" placeholder="Description (reads like a story explainer)" maxLength={280} />
          <span className="check-group">
            {["top", ...data.sections, "sidebar"].map((s) => (
              <label key={s} title={s === "sidebar" ? "Middle column, shows on every story page and overrides the others" : undefined}>
                <input type="checkbox" name="placements" value={s} defaultChecked={s === "top"} />{" "}
                {s === "top" ? "top stories" : s === "sidebar" ? "middle column" : s}
              </label>
            ))}
          </span>
          <button className="btn" type="submit" disabled={busy}>
            Add
          </button>
        </div>
      </form>

      <h2 id="media">Podcasts</h2>
      <p className="sub">
        Episodes the pipeline aggregated from whitelisted shows onto /podcasts, the front-page box, and each one's
        section box. Unchecking hides an episode from the site (it stays here until it ages out). Re-judge runs the
        current media gate over the tier 2 episodes already shelved, hiding any that no longer pass, and refreshes
        every episode's section label.
      </p>
      <div className="btn-row">
        <button className="btn" disabled={busy} onClick={() => act("refreshMedia")}>
          Refresh shelf now
        </button>
        <button className="btn" disabled={busy} onClick={() => act("rejudgeMedia")}>
          Re-judge shelf
        </button>
      </div>
      {data.mediaItems.length === 0 ? <p className="empty-state">Nothing on the shelf yet.</p> : null}
      {data.mediaItems.map((m) => (
        <div key={m.id} className={`admin-card${m.hidden ? " is-hidden" : ""}`}>
          <div className="headline">
            <a href={m.url} rel="noopener" title={m.displayTitle ? `Show's title: ${m.title}` : undefined}>
              {m.displayTitle ?? m.title}
            </a>{" "}
            <span className="sub">
              · {m.sourceName} · {m.kind}
              {m.section ? <> · {m.section}</> : null}
              {m.durationSec ? <> · {Math.round(m.durationSec / 60)}m</> : null}
              {m.views ? <> · {m.views >= 1000 ? `${(m.views / 1000).toFixed(m.views >= 10000 ? 0 : 1)}k` : m.views} views</> : null} · {timeAgo(m.publishedAt)}
            </span>
          </div>
          <div className="btn-row">
            <label className="shown-check">
              <input
                type="checkbox"
                checked={!m.hidden}
                disabled={busy}
                onChange={() => act("toggleMediaHidden", { id: m.id })}
              />{" "}
              shown
            </label>
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                const title = new FormData(e.currentTarget).get("title") as string;
                act("setMediaTitle", { id: m.id, title });
              }}
            >
              <input
                className="text"
                name="title"
                defaultValue={m.displayTitle ?? ""}
                placeholder="Site title (optional, the show's title stays in the tooltip)"
              />
              <button className="btn" type="submit" disabled={busy}>
                Set title
              </button>
            </form>
          </div>
        </div>
      ))}

      {/* the paid listing rail is called Shows on the site, so the free
          free Podcasts section above and the paid listings never share a bare name */}
      {(["jobs", "events", "podcasts"] as const).map((kind) => (
        <div key={kind}>
          <h2 id={kind}>{kind === "podcasts" ? "Sponsored Podcasts" : kind.charAt(0).toUpperCase() + kind.slice(1)}</h2>
          {data[kind].map((l) => (
            <div key={l.id} className={`admin-card${l.hidden ? " is-hidden" : ""}`}>
              {editingId === l.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    setEditingId(null);
                    act("editListing", {
                      kind,
                      id: l.id,
                      title: f.get("title"),
                      url: f.get("url"),
                      org: f.get("org"),
                      date: f.get("date"),
                    });
                  }}
                >
                  <div className="form-row">
                    <input className="text" name="title" defaultValue={l.title} required />
                    <input className="text" name="url" defaultValue={l.url} required />
                    <input
                      className="text"
                      name="org"
                      defaultValue={l.org ?? ""}
                      placeholder={kind === "jobs" ? "Company" : kind === "events" ? "Organizer" : "Show"}
                    />
                    {kind === "events" ? (
                      <input className="text" name="date" defaultValue={l.date ?? ""} placeholder="Date" />
                    ) : null}
                    <button className="btn primary" type="submit" disabled={busy}>
                      Save
                    </button>
                    <button className="btn" type="button" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="headline">
                    {l.featured ? "★ " : ""}
                    {l.title} {l.org ? <span className="sub">· {l.org}</span> : null}
                  </div>
                  <div className="btn-row">
                    <label className="shown-check">
                      <input
                        type="checkbox"
                        checked={!l.hidden}
                        disabled={busy}
                        onChange={() => act("toggleShown", { kind, id: l.id })}
                      />{" "}
                      shown
                    </label>
                    <button className="btn" disabled={busy} onClick={() => setEditingId(l.id)}>
                      Edit
                    </button>
                    <button className="btn" disabled={busy} onClick={() => act("toggleFeatured", { kind, id: l.id })}>
                      {l.featured ? "Unfeature" : "Feature"}
                    </button>
                    <button
                      className="btn danger"
                      disabled={busy}
                      onClick={() => act("removeListing", { kind, id: l.id }, `Remove “${l.title}”?`)}
                    >
                      Remove
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              act("addListing", {
                kind,
                title: f.get("title"),
                url: f.get("url"),
                org: f.get("org"),
                date: f.get("date"),
                featured: f.get("featured") === "on",
              });
              e.currentTarget.reset();
            }}
          >
            <div className="form-row">
              <input className="text" name="title" placeholder="Title" required />
              <input className="text" name="url" placeholder="URL" required />
              <input
                className="text"
                name="org"
                placeholder={kind === "jobs" ? "Company" : kind === "events" ? "Organizer" : "Show"}
              />
              {kind === "events" ? <input className="text" name="date" placeholder="Date (e.g. Nov 17-19)" /> : null}
              <label style={{ alignSelf: "center", fontSize: "0.8rem" }}>
                <input type="checkbox" name="featured" /> featured
              </label>
              <button className="btn" type="submit" disabled={busy}>
                Add
              </button>
            </div>
          </form>
        </div>
      ))}
    </div>
  );
}
