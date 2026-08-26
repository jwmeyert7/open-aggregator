"use client";

import { useEffect, useRef, useState } from "react";
import { loadPlayhead, loadPlayState, MediaPlayer } from "@/components/MediaPlayer";

interface DockItem {
  url: string;
  kind: "video" | "podcast";
  title: string;
  audioUrl?: string;
  videoUrl?: string;
  chapters?: Array<{ at: number; label: string }>;
  startAt?: number;
  startPaused?: boolean;
}

/**
 * The corner dock: a small fixed player mounted in the root layout, so an
 * episode keeps playing while the reader browses the site. Players hand
 * playback here through the podcast:dock event. The dock also owns the
 * detached windows: on podcast:detach it opens the float (document
 * picture-in-picture, the reader's choice, never forced) or a plain popup,
 * hides itself while the window lives, and when the window closes it returns
 * at the window's last second, playing or paused exactly as the window left
 * it. The play state and playhead travel through the same localStorage keys
 * every player writes.
 */
export function MiniPlayer() {
  const [item, setItem] = useState<DockItem | null>(null);
  // playback lives in a detached window right now: the dock stays out of view
  const [away, setAway] = useState(false);
  const watcher = useRef<number | null>(null);

  useEffect(() => {
    const onDock = (e: Event) => {
      setAway(false);
      setItem((e as CustomEvent<DockItem>).detail);
    };
    window.addEventListener("podcast:dock", onDock);
    return () => window.removeEventListener("podcast:dock", onDock);
  }, []);

  useEffect(() => {
    const onDetach = async (e: Event) => {
      const d = (
        e as CustomEvent<{ mode: "float" | "window"; ytId?: string; fileUrl?: string; at: number; paused: boolean; title: string }>
      ).detail;
      if (!d.ytId && !d.fileUrl) return;
      // a direct-file episode detaches by its file URL; /player resolves the
      // episode (title, chapters) from state by that URL
      const who = d.ytId ? `v=${d.ytId}` : `f=${encodeURIComponent(d.fileUrl!)}`;
      const src = `/player?${who}${d.at > 0 ? `&t=${d.at}` : ""}${d.paused ? "&paused=1" : ""}`;
      // playhead and state round-trip on the same key every player uses
      const memKey = d.ytId ?? `video:${d.fileUrl}`;
      let win: Window | null = null;
      if (d.mode === "window") {
        win = window.open(src, "_blank", "popup,width=520,height=340");
      } else {
        const dpp = (window as unknown as { documentPictureInPicture?: { requestWindow: (o: object) => Promise<Window> } })
          .documentPictureInPicture;
        if (!dpp) return;
        const pip = await dpp.requestWindow({ width: 480, height: 292 });
        pip.document.title = d.title;
        pip.document.body.style.cssText = "margin:0;background:#000;overflow:hidden";
        const f = pip.document.createElement("iframe");
        // the PiP document is effectively about:blank, so a raw embed sends
        // no referrer and YouTube refuses it (error 153): /player is a real
        // same-origin URL, and wildcard delegation lets autoplay reach the
        // nested YouTube frame. Block display and viewport units keep the
        // frame exactly window sized.
        f.src = `${window.location.origin}${src}`;
        f.allow = "autoplay *; encrypted-media *; picture-in-picture *; fullscreen *";
        f.allowFullscreen = true;
        f.style.cssText = "border:0;display:block;width:100vw;height:100vh";
        pip.document.body.appendChild(f);
        win = pip;
      }
      if (!win) return;
      setAway(true);
      if (watcher.current !== null) window.clearInterval(watcher.current);
      watcher.current = window.setInterval(() => {
        if (!win || !win.closed) return;
        window.clearInterval(watcher.current!);
        watcher.current = null;
        // the window is gone: return at its last second, in its last state
        const pos = Math.floor(loadPlayhead(memKey));
        const paused = loadPlayState(memKey) !== 1;
        setItem((prev) => (prev ? { ...prev, startAt: pos > 0 ? pos : d.at, startPaused: paused } : prev));
        setAway(false);
      }, 500);
    };
    window.addEventListener("podcast:detach", onDetach);
    return () => {
      window.removeEventListener("podcast:detach", onDetach);
      if (watcher.current !== null) window.clearInterval(watcher.current);
    };
  }, []);

  if (!item || away) return null;
  return (
    <div className="mini-dock">
      <MediaPlayer
        id="dock"
        key={`${item.url}-${item.startAt ?? 0}-${item.startPaused ? "p" : "g"}`}
        url={item.url}
        kind={item.kind}
        title={item.title}
        audioUrl={item.audioUrl}
        videoUrl={item.videoUrl}
        chapters={item.chapters}
        compact
        autoOpen
        startAt={item.startAt}
        startPaused={item.startPaused}
        popOut={false}
        detach
        onClose={() => setItem(null)}
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
