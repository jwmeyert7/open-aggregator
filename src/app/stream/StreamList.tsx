"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export interface StreamItem {
  id: string;
  url: string;
  title: string;
  rawTitle?: string;
  sourceName: string;
  publishedAt: string;
  storySlug?: string;
  section?: string;
}

/** Client-rendered so dates and times appear in the visitor's own timezone. */
export function StreamList({ items }: { items: StreamItem[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const groups: Array<{ label: string; items: StreamItem[] }> = [];
  for (const item of items) {
    const label = new Date(item.publishedAt).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }

  return (
    <>
      {groups.map((g) => (
        <section key={g.label}>
          <h3 className="stream-date">{g.label}</h3>
          {g.items.map((i) => (
            <div key={i.id} className="stream-row">
              <span className="stream-time">
                {new Date(i.publishedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
              </span>
              <div className="stream-main">
                <a href={i.url} rel="noopener" title={i.rawTitle ? `Source title: ${i.rawTitle}` : undefined}>
                  {i.title}
                </a>{" "}
                <span className="org">
                  / {i.sourceName}
                  {i.storySlug ? (
                    <>
                      {" · "}
                      <Link href={`/story/${i.storySlug}`}>story</Link>
                    </>
                  ) : null}
                </span>
                {i.section ? (
                  <>
                    {" "}
                    {i.section === "general" ? (
                      <span className="pill general">general</span>
                    ) : (
                      <Link href={`/${i.section}`} className="pill section">
                        {i.section}
                      </Link>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </section>
      ))}
    </>
  );
}
