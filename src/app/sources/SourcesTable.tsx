"use client";

import Link from "next/link";
import { useState } from "react";

export type SourceType = "news" | "forum" | "primary" | "podcast";

export interface SourceRow {
  name: string;
  slug: string;
  count: number;
  /** most sources are one thing; an outlet with a show (Bankless) is two */
  types: SourceType[];
}

const TYPES: SourceType[] = ["news", "forum", "primary", "podcast"];

/**
 * The whole whitelist as one table: source, what kind of source it is, and
 * how much of the last month's site came from it. Type chips above filter
 * the list; either outer column header sorts.
 */
export function SourcesTable({ rows }: { rows: SourceRow[] }) {
  // alphabetical by default: readers scan for a name; the count column is one
  // click away for the curious
  const [key, setKey] = useState<"name" | "count">("name");
  const [asc, setAsc] = useState(true);
  const [only, setOnly] = useState<SourceType | null>(null);

  const shown = only ? rows.filter((r) => r.types.includes(only)) : rows;
  const sorted = [...shown].sort((a, b) => {
    const d = key === "name" ? a.name.localeCompare(b.name) : a.count - b.count;
    return (asc ? d : -d) || a.name.localeCompare(b.name);
  });

  function toggle(k: "name" | "count") {
    if (key === k) setAsc((v) => !v);
    else {
      setKey(k);
      setAsc(k === "name");
    }
  }

  const arrow = (k: "name" | "count") => (key === k ? (asc ? " ↑" : " ↓") : "");

  return (
    <>
      <div className="source-filters">
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
      <table className="leaderboard">
        <thead>
          <tr>
            <th className="sortable" onClick={() => toggle("name")}>
              Source
              {arrow("name")}
            </th>
            <th>Type</th>
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
              <td>{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
