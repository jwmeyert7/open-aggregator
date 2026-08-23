"use client";

import type { SourceCandidate } from "@/lib/types";
import { AdminChrome, type AdminChromeData, Toast, useAdminAct } from "../shared";

export interface SourcesData {
  sections: string[];
  sources: Array<{
    id: string;
    name: string;
    url: string;
    tier: 1 | 2;
    weight: number;
    category: string;
    type: string;
    thumbStyle: string;
    custom: boolean;
    disabled: boolean;
    health: string;
  }>;
  sourceCandidates: SourceCandidate[];
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

export function SourcesClient({ chrome, data }: { chrome: AdminChromeData; data: SourcesData }) {
  const { busy, status, setStatus, act } = useAdminAct();

  return (
    <div>
      <AdminChrome chrome={chrome} />
      <Toast status={status} onClear={() => setStatus("")} />

      <h2 id="candidates">Source candidates</h2>
      <p className="status-line">
        Domains the configured Farcaster discovery channel keeps linking that none of our sources cover. Nothing here is
        published. Judge the examples, then Add the good ones: it finds the domain&apos;s feed (Discourse, RSS, or
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
                      act("editFeed", { id: s.id, tier: f.get("tier"), weight: f.get("weight"), category: f.get("category"), thumbStyle: f.get("thumbStyle") });
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
                      {s.type === "youtube" || s.type === "podcast" ? (
                        <select
                          className="select"
                          name="thumbStyle"
                          defaultValue={s.thumbStyle}
                          style={{ width: "auto" }}
                          title="What the episode tile shows: the episode's own art, a plain frame from the video, or a flat tile with the show's name"
                        >
                          <option value="episode">episode art</option>
                          <option value="frame">video frame</option>
                          <option value="show">show tile</option>
                        </select>
                      ) : null}
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
    </div>
  );
}
