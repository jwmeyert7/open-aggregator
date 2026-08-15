"use client";

import { useState } from "react";

export interface LeaderRow {
  name: string;
  category: string;
  /** YYYY-MM-DD the source joined the whitelist; empty for pre-tracking history rows. */
  added: string;
  stories: number;
  leads: number;
  items: number;
  points: number;
  avg: number;
  considered: number;
  passed: number;
  /** Percent, or -1 when nothing has been considered yet (sorts below 0%). */
  inclusion: number;
}

type SortKey =
  | "name"
  | "category"
  | "added"
  | "stories"
  | "leads"
  | "items"
  | "points"
  | "avg"
  | "considered"
  | "passed"
  | "inclusion";
const STRING_KEYS: SortKey[] = ["name", "category", "added"];

const COLUMNS: Array<{ key: SortKey; label: string; title: string; admin?: boolean }> = [
  { key: "name", label: "Source", title: "Sort alphabetically" },
  { key: "category", label: "Category", title: "Sort by category (admin-only grouping)" },
  {
    key: "added",
    label: "Added 🔒",
    title: "Day the source joined the whitelist. Blank rows predate tracking or left the whitelist. Keep admin-only.",
    admin: true,
  },
  { key: "stories", label: "Stories", title: "Stories this source appeared in" },
  { key: "leads", label: "Leads", title: "Stories where this source is the lead link" },
  { key: "items", label: "Links", title: "Total links contributed" },
  {
    key: "considered",
    label: "Considered 🔒",
    title: "Items from this source the editor gated, passed or rejected, over the days with gate data. NEVER make public.",
    admin: true,
  },
  {
    key: "passed",
    label: "Passed 🔒",
    title: "Items from this source that cleared the gate over those same days. NEVER make public.",
    admin: true,
  },
  {
    key: "inclusion",
    label: "Inclusion 🔒",
    title: "Passed / considered, as a percent, over the same days. Not derived from the Stories column. NEVER make public.",
    admin: true,
  },
  { key: "points", label: "Rank pts 🔒", title: "Sum of current rank scores of this source's stories. NEVER make public.", admin: true },
  { key: "avg", label: "Avg rank 🔒", title: "Rank points / stories. NEVER make public.", admin: true },
];

export function LeaderboardTable({ rows }: { rows: LeaderRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("stories");
  const [asc, setAsc] = useState(false);

  function clickColumn(key: SortKey) {
    if (key === sortKey) {
      setAsc(!asc);
    } else {
      setSortKey(key);
      setAsc(STRING_KEYS.includes(key)); // strings default A→Z, numbers default high→low
    }
  }

  const sorted = [...rows].sort((a, b) => {
    const cmp = STRING_KEYS.includes(sortKey)
      ? (a[sortKey] as string).localeCompare(b[sortKey] as string, undefined, { sensitivity: "base" }) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      : (a[sortKey] as number) - (b[sortKey] as number);
    return asc ? cmp : -cmp;
  });

  const arrow = (key: SortKey) => (key === sortKey ? (asc ? " ▲" : " ▼") : "");

  return (
    <table className="leaderboard">
      <thead>
        <tr>
          <th>#</th>
          {COLUMNS.map((c) => (
            <th
              key={c.key}
              className={c.admin ? "admin-col sortable" : "sortable"}
              title={c.title}
              onClick={() => clickColumn(c.key)}
            >
              {c.label}
              {arrow(c.key)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r, i) => (
          <tr key={r.name}>
            <td>{i + 1}</td>
            <td>
              <a href={`/admin?filter=${encodeURIComponent(r.name)}#stories`} title="See this source's stories in the admin">
                {r.name}
              </a>
            </td>
            <td className="org">{r.category || "-"}</td>
            <td className="admin-col org">{r.added || "-"}</td>
            <td>{r.stories}</td>
            <td>{r.leads}</td>
            <td>{r.items}</td>
            <td className="admin-col">{r.considered}</td>
            <td className="admin-col">{r.passed}</td>
            <td className="admin-col">{r.inclusion < 0 ? "-" : `${r.inclusion.toFixed(0)}%`}</td>
            <td className="admin-col">{r.points.toFixed(1)}</td>
            <td className="admin-col">{r.avg.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
