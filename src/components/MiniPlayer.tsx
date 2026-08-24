"use client";

import { useEffect, useState } from "react";
import { MediaPlayer } from "@/components/MediaPlayer";

interface DockItem {
  url: string;
  kind: "video" | "podcast";
  title: string;
  audioUrl?: string;
  videoUrl?: string;
  startAt?: number;
}

/**
 * The corner dock: a small fixed player mounted in the root layout, so an
 * episode keeps playing while the reader browses the site (the App Router
 * keeps the layout mounted across in-site navigation). Players hand playback
 * here through the podcast:dock event at the current second. From the dock
 * the reader can detach further, and the choice is theirs: float (document
 * picture-in-picture, Chromium only) or a plain popup window, because
 * picture-in-picture is one window per browser and this site must never
 * evict whatever a reader already has floating.
 */
export function MiniPlayer() {
  const [item, setItem] = useState<DockItem | null>(null);

  useEffect(() => {
    const onDock = (e: Event) => setItem((e as CustomEvent<DockItem>).detail);
    window.addEventListener("podcast:dock", onDock);
    return () => window.removeEventListener("podcast:dock", onDock);
  }, []);

  if (!item) return null;
  return (
    <div className="mini-dock">
      <MediaPlayer
        id="dock"
        key={`${item.url}-${item.startAt ?? 0}`}
        url={item.url}
        kind={item.kind}
        title={item.title}
        audioUrl={item.audioUrl}
        videoUrl={item.videoUrl}
        compact
        autoOpen
        startAt={item.startAt}
        popOut={false}
        detach
        header={
          <div className="dock-head">
            <span className="dock-title">{item.title}</span>
            <button type="button" className="linklike" onClick={() => setItem(null)} title="Close the dock">
              close
            </button>
          </div>
        }
      >
        <span />
      </MediaPlayer>
    </div>
  );
}
