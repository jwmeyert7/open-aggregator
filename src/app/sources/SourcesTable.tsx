"use client";

import Link from "next/link";
import { useState } from "react";

export interface SourceRow {
  name: string;
  slug: string;
  count: number;
}

/** Two-column public table, click either header to sort. The sources page uses it for the news sources and the podcast shows alike. */
export function SourcesTable({
  rows,
  nameHeader = "Source",
  countHeader = "Items, last 30 days",
  href,
}: {
  rows: SourceRow[];
  nameHeader?: string;
  countHeader?: string;
  /** row link target; defaults to the source's own article page */
  href?: (r: SourceRow) => string;
}) {
  const [key, setKey] = useState<"name" | "count">("count");
  const [asc, setAsc] = useState(false);

  const sorted = [...rows].sort((a, b) => {
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
    <table className="leaderboard">
      <thead>
        <tr>
          <th className="sortable" onClick={() => toggle("name")}>
            {nameHeader}
            {arrow("name")}
          </th>
          <th className="sortable" onClick={() => toggle("count")}>
            {countHeader}
            {arrow("count")}
          </th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.name}>
            <td>
              <Link href={href ? href(r) : `/sources/${r.slug}`}>{r.name}</Link>
            </td>
            <td>{r.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
