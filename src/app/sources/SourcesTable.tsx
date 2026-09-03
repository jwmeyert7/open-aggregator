"use client";

import Link from "next/link";
import { useState } from "react";

export type SourceType = "news" | "forum" | "primary" | "podcast";

export interface SourceRow {
  name: string;
  slug: string;
  count: number;
  /** most sources are one thing; an outlet with a show is two */
  types: SourceType[];
  /** where this source's items filed in the window, most common first; a hint in brackets when nothing filed yet */
  sections: string[];
}

type SortKey = "name" | "type" | "section" | "count";

const TYPES: SourceType[] = ["news", "forum", "primary", "podcast"];

/**
 * The whole whitelist as one table: source, what kind of source it is, and
 * how much of the last month's site came from it. Type chips above filter
 * the list; either outer column header sorts.
 */
export function SourcesTable({ rows, sectionOrder }: { rows: SourceRow[]; sectionOrder: string[] }) {
  // alphabetical by default: readers scan for a name; the other columns are
  // one click away for the curious (type sort doubles as grouping)
  const [key, setKey] = useState<SortKey>("name");
  const [asc, setAsc] = useState(true);
  const [only, setOnly] = useState<SourceType | null>(null);
  const [section, setSection] = useState<string | null>(null);

  // the section chips are whatever sections the window actually filed under,
  // in the front page's order
  const filed = new Set(rows.flatMap((r) => r.sections.filter((s) => !s.startsWith("("))));
  const sections = sectionOrder.filter((s) => filed.has(s));
  const shown = rows.filter(
    (r) => (!only || r.types.includes(only)) && (!section || r.sections.includes(section))
  );
  const sorted = [...shown].sort((a, b) => {
    const d =
      key === "name"
        ? a.name.localeCompare(b.name)
        : key === "type"
          ? a.types.join(", ").localeCompare(b.types.join(", "))
          : key === "section"
            ? a.sections.join(", ").localeCompare(b.sections.join(", "))
            : a.count - b.count;
    return (asc ? d : -d) || a.name.localeCompare(b.name);
  });

  function toggle(k: SortKey) {
    if (key === k) setAsc((v) => !v);
    else {
      setKey(k);
      setAsc(k !== "count");
    }
  }

  const arrow = (k: SortKey) => (key === k ? (asc ? " ↑" : " ↓") : "");

  return (
    <>
      <div className="source-filters">
        <span className="filter-label">Type</span>
        <button type="button" className={`filter-chip${only === null ? " on" : ""}`} onClick={() => setOnly(null)}>
          all
        </button>
        {TYPES.map((t) => (
          <button
            key={t}
            type="button"
            className={`filter-chip${only === t ? " on" : ""}`}
            onClick={() => setOnly((v) => (v === t ? null : t))}
          >
            {t}
          </button>
        ))}
      </div>
      {sections.length > 0 ? (
        <div className="source-filters">
          <span className="filter-label">Section</span>
          <button type="button" className={`filter-chip${section === null ? " on" : ""}`} onClick={() => setSection(null)}>
            all
          </button>
          {sections.map((s) => (
            <button
              key={s}
              type="button"
              className={`filter-chip${section === s ? " on" : ""}`}
              onClick={() => setSection((v) => (v === s ? null : s))}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
      <table className="leaderboard">
        <thead>
          <tr>
            <th className="sortable" onClick={() => toggle("name")}>
              Source
              {arrow("name")}
            </th>
            <th className="sortable" onClick={() => toggle("type")}>
              Type
              {arrow("type")}
            </th>
            <th className="sortable" onClick={() => toggle("section")}>
              Section
              {arrow("section")}
            </th>
            <th className="sortable" onClick={() => toggle("count")}>
              Items, last 30 days
              {arrow("count")}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.name}>
              <td>
                <Link href={`/sources/${r.slug}`}>{r.name}</Link>
              </td>
              <td className="org">{r.types.join(", ")}</td>
              <td className="org">{r.sections.join(", ")}</td>
              <td>{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
