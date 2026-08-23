"use client";

import Link from "next/link";
import { MediaPlayer } from "@/components/MediaPlayer";
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
  /** podcast episodes merged into the flow; playHref opens the in-site player */
  podcast?: boolean;
  playHref?: string;
  /** episodes: what the row needs to play in place */
  episode?: { id: string; url: string; kind: "video" | "podcast"; title: string; thumbnail?: string; audioUrl?: string; videoUrl?: string };
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
            <div key={i.id} className={`stream-row${i.episode ? " stream-episode" : ""}`}>
              <span className="stream-time">
                {new Date(i.publishedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
              </span>
              {i.episode ? (
                // an episode plays right here, same player as the Podcasts box
                <div className="stream-main">
                  <MediaPlayer
                    id={`stream-${i.episode.id}`}
                    url={i.episode.url}
                    kind={i.episode.kind}
                    title={i.title}
                    thumbnail={i.episode.thumbnail}
                    audioUrl={i.episode.audioUrl}
                    videoUrl={i.episode.videoUrl}
                    compact
                  >
                    <div className="media-body">
                      <a href={i.url} rel="noopener" title={i.rawTitle ? `Show's title: ${i.rawTitle}` : undefined}>
                        {i.title}
                      </a>{" "}
                      <span className="org">
                        <span className="kind-tag">podcast</span>/ {i.sourceName}
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
                  </MediaPlayer>
                </div>
              ) : (
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
              )}
            </div>
          ))}
        </section>
      ))}
    </>
  );
}
