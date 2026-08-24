"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A story's "discussed at 12:34 on Bankless" link. A plain click plays the
 * clip right here, in the corner dock, from that second, with the expand and
 * detach controls along for the ride; middle-click or a modified click still
 * lands on /podcasts as before. Playback data is fetched on demand so the
 * cards stay light.
 */
export function MentionLink({
  mediaId,
  at,
  href,
  title,
  children,
}: {
  mediaId: string;
  at?: number;
  href: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="mention-link"
      title={title}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        fetch(`/api/episode?id=${encodeURIComponent(mediaId)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (!d) {
              window.location.href = href;
              return;
            }
            window.dispatchEvent(
              new CustomEvent("podcast:dock", {
                detail: {
                  url: d.url,
                  kind: d.kind,
                  title: d.title,
                  audioUrl: d.audioUrl,
                  videoUrl: d.videoUrl,
                  startAt: at ?? 0,
                },
              })
            );
          })
          .catch(() => {
            window.location.href = href;
          });
      }}
    >
      {children}
    </Link>
  );
}
