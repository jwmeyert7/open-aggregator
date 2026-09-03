"use client";

import { useState } from "react";
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
    sectionHint: string;
    thumbStyle: string;
    custom: boolean;
    disabled: boolean;
    health: string;
    /** "ok" | "bad" | "new" for sorting and coloring; the text above is the detail */
    healthKind: "ok" | "bad" | "new";
    /** accepted items (or episodes) in the last 30 days */
    count: number;
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
  "media",
  "discovery",
  "other",
];

type Row = SourcesData["sources"][number];
type SortKey = "name" | "category" | "type" | "tier" | "weight" | "sectionHint" | "count" | "health";

export function SourcesClient({ chrome, data }: { chrome: AdminChromeData; data: SourcesData }) {
  const { busy, status, setStatus, act } = useAdminAct();
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<"all" | "enabled" | "disabled" | "unhealthy">("all");
  const [tier, setTier] = useState<"all" | "1" | "2">("all");
  const [category, setCategory] = useState("all");
  const [section, setSection] = useState("all");
  const [key, setKey] = useState<SortKey>("name");
  const [asc, setAsc] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const shown = data.sources.filter(
    (s) =>
      (!q || [s.name, s.url, s.id, s.category, s.type].some((v) => v.toLowerCase().includes(q))) &&
      (only === "all" || (only === "enabled" && !s.disabled) || (only === "disabled" && s.disabled) || (only === "unhealthy" && s.healthKind === "bad")) &&
      (tier === "all" || String(s.tier) === tier) &&
      (section === "all" || s.sectionHint === section) &&
      (category === "all" || s.category === category)
  );
  const healthOrder = { bad: 0, new: 1, ok: 2 } as const;
  const sorted = [...shown].sort((a, b) => {
    const d =
      key === "name"
        ? a.name.localeCompare(b.name)
        : key === "category"
          ? a.category.localeCompare(b.category)
          : key === "type"
            ? a.type.localeCompare(b.type)
            : key === "tier"
              ? a.tier - b.tier
              : key === "weight"
                ? a.weight - b.weight
                : key === "sectionHint"
                  ? a.sectionHint.localeCompare(b.sectionHint)
                  : key === "count"
                    ? a.count - b.count
                    : healthOrder[a.healthKind] - healthOrder[b.healthKind];
    return (asc ? d : -d) || a.name.localeCompare(b.name);
  });
  function toggle(k: SortKey) {
    if (key === k) setAsc((v) => !v);
    else {
      setKey(k);
      setAsc(k !== "count" && k !== "weight");
    }
  }
  const arrow = (k: SortKey) => (key === k ? (asc ? " ↑" : " ↓") : "");
  const categories = [...new Set([...SOURCE_CATEGORIES, ...data.sources.map((s) => s.category)])].filter((c) =>
    data.sources.some((s) => s.category === c)
  );

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
        Every source the pipeline reads, built-in and admin-added. Click a row to edit it. Built-in sources come from
        config/feeds.json and can be edited or disabled here (the edit is an override in site state). Sources you add
        can also be removed. Changes take effect on the next pipeline run.
      </p>
      <details className="source-group">
        <summary>Add a source by hand</summary>
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
              category: f.get("category"),
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
      </details>

      <div className="form-row">
        <input
          className="text"
          placeholder="Filter sources by name, URL, id, category, or type…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="source-filters">
        <span className="filter-label">Status</span>
        {(["all", "enabled", "disabled", "unhealthy"] as const).map((v) => (
          <button key={v} type="button" className={`filter-chip${only === v ? " on" : ""}`} onClick={() => setOnly(v)}>
            {v}
          </button>
        ))}
      </div>
      <div className="source-filters">
        <span className="filter-label">Section</span>
        {["all", ...data.sections].map((v) => (
          <button key={v} type="button" className={`filter-chip${section === v ? " on" : ""}`} onClick={() => setSection(v)}>
            {v}
          </button>
        ))}
      </div>
      <div className="source-filters">
        <span className="filter-label">Tier</span>
        {(["all", "1", "2"] as const).map((v) => (
          <button key={v} type="button" className={`filter-chip${tier === v ? " on" : ""}`} onClick={() => setTier(v)}>
            {v === "all" ? "all" : `tier ${v}`}
          </button>
        ))}
        <span className="filter-label" style={{ marginLeft: 12 }}>
          Category
        </span>
        <select className="select" value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: "auto" }}>
          <option value="all">all</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="sub" style={{ marginLeft: "auto" }}>
          {sorted.length} of {data.sources.length}
        </span>
      </div>

      <table className="leaderboard sources-admin">
        <thead>
          <tr>
            <th className="sortable" onClick={() => toggle("name")}>
              Source{arrow("name")}
            </th>
            <th className="sortable" onClick={() => toggle("type")}>
              Type{arrow("type")}
            </th>
            <th className="sortable" onClick={() => toggle("category")}>
              Category{arrow("category")}
            </th>
            <th className="sortable" onClick={() => toggle("sectionHint")} title="The section this source's items default to. The editor can still file a story elsewhere.">
              Section{arrow("sectionHint")}
            </th>
            <th className="sortable" onClick={() => toggle("tier")}>
              Tier{arrow("tier")}
            </th>
            <th className="sortable" onClick={() => toggle("weight")}>
              Weight{arrow("weight")}
            </th>
            <th className="sortable" onClick={() => toggle("count")} title="Accepted items or episodes, last 30 days">
              30d{arrow("count")}
            </th>
            <th className="sortable" onClick={() => toggle("health")}>
              Health{arrow("health")}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => (
            <SourceRows
              key={s.id}
              s={s}
              sections={data.sections}
              open={open === s.id}
              onToggle={() => setOpen((v) => (v === s.id ? null : s.id))}
              busy={busy}
              act={act}
            />
          ))}
        </tbody>
      </table>
      {sorted.length === 0 ? <p className="empty-state">No source matches those filters.</p> : null}
    </div>
  );
}

function SourceRows({
  s,
  sections,
  open,
  onToggle,
  busy,
  act,
}: {
  s: Row;
  sections: string[];
  open: boolean;
  onToggle: () => void;
  busy: boolean;
  act: (action: string, payload?: Record<string, unknown>, confirmText?: string) => Promise<void>;
}) {
  return (
    <>
      <tr id={`feed-${s.id}`} className={`source-row${s.disabled ? " disabled" : ""}${open ? " open" : ""}`} onClick={onToggle}>
        <td>
          {s.disabled ? <span title="Disabled">⏸ </span> : null}
          {s.name}
          {s.custom ? <span className="sub"> (added by admin)</span> : null}
          <div className="sub source-url">{s.url}</div>
        </td>
        <td className="org">{s.type}</td>
        <td className="org">{s.category}</td>
        <td className="org">{s.sectionHint || "·"}</td>
        <td>{s.tier}</td>
        <td>{s.weight}</td>
        <td>{s.count}</td>
        <td>
          <span className={s.healthKind === "ok" ? "health-ok" : s.healthKind === "bad" ? "health-bad" : ""} title={s.health}>
            {s.healthKind === "ok" ? "ok" : s.healthKind === "new" ? "not yet polled" : s.health}
          </span>
        </td>
      </tr>
      {open ? (
        <tr className="source-editor">
          <td colSpan={8}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                act("editFeed", {
                  id: s.id,
                  name: f.get("name"),
                  url: f.get("url"),
                  tier: f.get("tier"),
                  weight: f.get("weight"),
                  category: f.get("category"),
                  sectionHint: f.get("sectionHint"),
                  ...(s.type === "youtube" || s.type === "podcast" ? { thumbStyle: f.get("thumbStyle") } : {}),
                });
              }}
            >
              <div className="form-row">
                <input className="text" name="name" defaultValue={s.name} placeholder="Name" style={{ maxWidth: 260 }} title="Display name. Existing story links keep the name they were filed under." />
                <input className="text" name="url" defaultValue={s.url} placeholder="Feed URL" title="Feed URL. The id stays the same, so history and health carry over." />
              </div>
              <div className="btn-row">
                <select className="select" name="tier" defaultValue={String(s.tier)} style={{ width: "auto" }} title="Tier 1 passes through. Tier 2 goes through the LLM gate">
                  <option value="1">tier 1</option>
                  <option value="2">tier 2</option>
                </select>
                <input className="text" name="weight" defaultValue={s.weight} style={{ maxWidth: 90 }} title="Ranking weight (0.1-5)" />
                <select className="select" name="category" defaultValue={s.category} style={{ width: "auto" }}>
                  {[...new Set([...SOURCE_CATEGORIES, s.category])].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <select className="select" name="sectionHint" defaultValue={s.sectionHint} style={{ width: "auto" }} title="Where this source's items usually belong">
                  <option value="">no section hint</option>
                  {sections.map((x) => (
                    <option key={x} value={x}>
                      {x}
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
                    <option value="frame">video frame (early)</option>
                    <option value="frame2">video frame (middle)</option>
                    <option value="frame3">video frame (late)</option>
                    <option value="show">show tile</option>
                  </select>
                ) : null}
                <button className="btn primary" type="submit" disabled={busy}>
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
                <span className="sub" style={{ marginLeft: "auto" }}>
                  id {s.id} · {s.health}
                </span>
              </div>
            </form>
          </td>
        </tr>
      ) : null}
    </>
  );
}
