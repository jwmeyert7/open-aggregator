"use client";

import Link from "next/link";
import { useState } from "react";

export interface SourceRow {
  name: string;
  slug: string;
  count: number;
}

/** Two-column public source table, click either header to sort. */
export function SourcesTable({ rows }: { rows: SourceRow[] }) {
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
            Source{arrow("name")}
          </th>
          <th className="sortable" onClick={() => toggle("count")}>
            Items, last 30 days{arrow("count")}
          </th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.name}>
            <td>
              <Link href={`/sources/${r.slug}`}>{r.name}</Link>
            </td>
            <td>{r.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
