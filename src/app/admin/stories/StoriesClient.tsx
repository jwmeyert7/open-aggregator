"use client";

import { useState } from "react";
import type { ScoreBreakdown } from "@/lib/rank";
import { timeAgo } from "@/lib/util";
import { AdminChrome, type AdminChromeData, Toast, useAdminAct } from "../shared";

export interface StoryRow {
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
  linkList: Array<{ url: string; sourceName: string; title: string; publishedAt: string; addedAt: string; undated: boolean }>;
  leadUrl: string | null;
  /** the link the reader actually sees as the kicker right now, pinned or automatic */
  currentLeadUrl: string | null;
  pinned: boolean;
  needsReview: boolean;
  postedX: boolean;
  postedFarcaster: boolean;
}

export interface StoriesData {
  sections: string[];
  clusters: StoryRow[];
  xMonthly: { used: number; cap: number };
  submissions: Array<{
    id: string;
    url: string;
    note?: string;
    email?: string;
    storyHeadline?: string;
    storySlug?: string;
    newSource: boolean;
    asStory?: boolean;
    asSource?: boolean;
    sections?: string[];
    at: string;
  }>;
}

/**
 * Type-to-find replacement for the old "Merge into…" dropdown, which listed
 * every live story and became unusable once the admin shipped them all.
 * Closed it is one button. Open it shows the top-ranked stories and narrows
 * as you type, using the same matching as the story filter above.
 */
function MergePicker({
  from,
  clusters,
  busy,
  onPick,
}: {
  from: StoryRow;
  clusters: StoryRow[];
  busy: boolean;
  onPick: (target: StoryRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  if (!open) {
    return (
      <button className="btn" disabled={busy} onClick={() => setOpen(true)}>
        Merge into…
      </button>
    );
  }

  const ql = q.trim().toLowerCase();
  const others = clusters.filter((o) => o.id !== from.id);
  const matches = (
    ql
      ? others.filter(
          (o) =>
            o.headline.toLowerCase().includes(ql) ||
            o.section === ql ||
            o.linkList.some((l) => l.sourceName.toLowerCase().includes(ql))
        )
      : others
  ).slice(0, 8);

  return (
    <div className="merge-pick">
      <div className="form-row">
        <input
          className="text"
          autoFocus
          placeholder="Type to find the story this one merges into…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          className="btn"
          type="button"
          onClick={() => {
            setOpen(false);
            setQ("");
          }}
        >
          Cancel
        </button>
      </div>
      {matches.map((o) => (
        <button
          key={o.id}
          type="button"
          className="merge-option"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setQ("");
            onPick(o);
          }}
        >
          <span className="merge-headline">{o.headline}</span>
          <span className="sub">
            {o.section} · {o.links} link{o.links === 1 ? "" : "s"} · created {timeAgo(o.createdAt)}
          </span>
        </button>
      ))}
      {matches.length === 0 ? <p className="empty-state">No stories match.</p> : null}
      {!ql && others.length > 8 ? (
        <p className="sub merge-hint">Showing the top 8 of {others.length}. Type to search them all.</p>
      ) : null}
    </div>
  );
}

export function StoriesClient({
  chrome,
  data,
  initialFilter = "",
  initialStoryId,
}: {
  chrome: AdminChromeData;
  data: StoriesData;
  initialFilter?: string;
  /** the site's edit links land here: show exactly this story until cleared */
  initialStoryId?: string;
}) {
  const { busy, status, setStatus, act } = useAdminAct();
  const [storyQuery, setStoryQuery] = useState(initialFilter);
  const [showAllStories, setShowAllStories] = useState(false);
  const [pinnedId, setPinnedId] = useState(initialStoryId);

  return (
    <div>
      <AdminChrome chrome={chrome} />
      <Toast status={status} onClear={() => setStatus("")} />

      <h2 id="stories">Stories</h2>
      <div className="form-row">
        <input
          className="text"
          placeholder="Filter stories by headline, section, or source…"
          value={storyQuery}
          onChange={(e) => {
            setStoryQuery(e.target.value);
            setPinnedId(undefined);
          }}
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
        const pinned = !q && pinnedId ? data.clusters.filter((c) => c.id === pinnedId) : null;
        const shown = pinned ?? (showAllStories || q ? filtered : filtered.slice(0, 15));
        return (
          <>
            {pinned ? (
              <p className="status-line">
                Showing one story, straight from its edit link.{" "}
                <button className="btn" onClick={() => setPinnedId(undefined)}>
                  Show the list
                </button>
              </p>
            ) : null}
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
                        {c.breakdown.importanceCapped ? ", capped to 2 (single uncorroborated forum source)" : ""},
                        multiplying the score by {c.breakdown.importanceFactor.toFixed(2)}. Routine items sink,
                        ecosystem-defining ones rise.
                      </span>
                      <span className="score-line">
                        <strong>Topic centrality:</strong> rated {c.breakdown.centrality}/5 for how specifically this
                        is about the site&apos;s topic, multiplying by {c.breakdown.centralityFactor.toFixed(2)}. On-topic
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
                  <MergePicker
                    from={c}
                    clusters={data.clusters}
                    busy={busy}
                    onPick={(target) =>
                      act(
                        "merge",
                        { clusterId: c.id, targetId: target.id },
                        `Merge “${c.headline}” into “${target.headline}”?`
                      )
                    }
                  />
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
                  <button
                    className="btn"
                    disabled={busy}
                    title="Rename the kicker source (the outlet name the reader sees before the headline)"
                    onClick={() => {
                      const name = window.prompt("Source name for the kicker:", c.linkList[0]?.sourceName ?? "");
                      if (name === null) return;
                      act("renameSource", { clusterId: c.id, name });
                    }}
                  >
                    Rename source
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
                            <span className="sub link-when">
                              {l.undated ? (
                                "no publish date"
                              ) : (
                                <span title={new Date(l.publishedAt).toUTCString().replace("GMT", "UTC")}>
                                  published {timeAgo(l.publishedAt)}
                                </span>
                              )}
                              {l.addedAt ? (
                                <>
                                  {" · "}
                                  <span title={new Date(l.addedAt).toUTCString().replace("GMT", "UTC")}>
                                    added {timeAgo(l.addedAt)}
                                  </span>
                                </>
                              ) : null}
                              {" · "}
                              <a href={l.url} target="_blank" rel="noopener">
                                view ↗
                              </a>
                            </span>
                          </label>
                          <button
                            type="button"
                            className="btn lead-btn"
                            disabled={busy}
                            title={
                              c.leadUrl === l.url
                                ? "Pinned as the lead. Click to return to automatic."
                                : c.currentLeadUrl === l.url
                                  ? "The automatic lead right now, chosen by tier and weight. Click to pin it so it stays."
                                  : "Pin this link as the story's lead (the kicker source)"
                            }
                            onClick={() => act("setLead", { clusterId: c.id, url: c.leadUrl === l.url ? "" : l.url })}
                          >
                            {c.leadUrl === l.url ? "lead ✓ pinned" : c.currentLeadUrl === l.url ? "lead ✓ auto" : "make lead"}
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
        <SubmissionCard key={s.id} s={s} sections={data.sections} busy={busy} act={act} />
      ))}
    </div>
  );
}


type SubmissionRow = StoriesData["submissions"][number];

/**
 * One pending reader suggestion. The submitter may have guessed a section;
 * the human confirms one here, and it rides along on Approve (for the story)
 * and Add as source (as the feed's section hint). Empty leaves the call to
 * the editor model, as before.
 */
function SubmissionCard({
  s,
  sections,
  busy,
  act,
}: {
  s: SubmissionRow;
  sections: string[];
  busy: boolean;
  act: (action: string, payload?: Record<string, unknown>, confirmText?: string) => Promise<void>;
}) {
  const [section, setSection] = useState(s.sections?.[0] ?? "");
  const confirmed = section ? { section } : {};
  return (
    <div className="admin-card">
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
        {s.asStory || s.asSource
          ? ` · submitter: ${[s.asStory ? "new story" : null, s.asSource ? "new source" : null].filter(Boolean).join(" + ")}`
          : ""}
        {s.sections && s.sections.length > 0 ? ` · suggested for ${s.sections.join(" + ")}` : ""}
        {s.email ? ` · from ${s.email}` : ""}
      </div>
      {s.note ? <div className="sub">“{s.note}”</div> : null}
      <div className="btn-row">
        <button
          className="btn primary"
          disabled={busy}
          onClick={() => act("approveSubmission", { id: s.id, ...confirmed })}
        >
          Approve
        </button>
        <button className="btn" disabled={busy} onClick={() => act("dismissSubmission", { id: s.id })}>
          Dismiss
        </button>
        {s.newSource ? (
          <button
            className="btn"
            disabled={busy}
            title="Find this domain's feed and add it as a tier 2 source (separate from approving the story)"
            onClick={() => act("addSubmissionSource", { id: s.id, ...confirmed })}
          >
            Add as source
          </button>
        ) : null}
        {!s.storyHeadline ? (
          <select
            className="select"
            style={{ width: "auto" }}
            value={section}
            disabled={busy}
            title="Confirm where the approved story or added source lands. Empty leaves it to the editor."
            onChange={(e) => setSection(e.target.value)}
          >
            <option value="">section: editor decides</option>
            {sections.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </div>
  );
}
