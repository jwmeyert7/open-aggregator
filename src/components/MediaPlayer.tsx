"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** The v= id of a YouTube watch, shorts, live, embed, or youtu.be URL, or null for anything else (client twin of feeds.ts). */
function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (/(^|\.)youtu\.be$/.test(u.hostname)) return u.pathname.slice(1).split("/")[0] || null;
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{6,})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const YT_EMBED_ORIGIN = "https://www.youtube-nocookie.com";

/**
 * Playhead memory, per episode, in this browser only (localStorage). Closing
 * the player and reopening it, here or on another page, resumes where the
 * reader was. Positions inside the first five seconds or the last thirty are
 * not worth remembering.
 */
const POS_KEY = "playhead:";
function loadPos(key: string): number {
  try {
    const v = Number(window.localStorage.getItem(POS_KEY + key));
    return Number.isFinite(v) && v > 5 ? v : 0;
  } catch {
    return 0;
  }
}
function savePos(key: string, sec: number, total?: number): void {
  try {
    if (sec <= 5 || (total && total - sec < 30)) window.localStorage.removeItem(POS_KEY + key);
    else window.localStorage.setItem(POS_KEY + key, String(Math.floor(sec)));
  } catch {
    // private mode or storage full: just no memory
  }
}

/**
 * One episode with click-to-load playback. Nothing from YouTube or a podcast
 * host loads until the reader presses play: then a YouTube video becomes a
 * youtube-nocookie.com embed (the creator's own player, so their ads and view
 * counts still count) and a podcast episode becomes a plain audio element
 * streaming from the show's host. Episodes that cannot embed keep the plain
 * thumbnail link. The row's text comes in as children from the server page,
 * so only the play state lives on the client.
 *
 * The YouTube embed reports its playhead over postMessage (the IFrame API's
 * infoDelivery events), so the "watch on YouTube" link carries &t= and lands
 * the reader at the moment they were watching.
 *
 * compact: the middle-column box on the front and section pages, where the
 * player is a small one spanning the column.
 */
export function MediaPlayer({
  id,
  url,
  kind,
  title,
  thumbnail,
  audioUrl,
  videoUrl,
  autoOpen = false,
  compact = false,
  header,
  startAt,
  tileText,
  children,
}: {
  id: string;
  url: string;
  kind: "video" | "podcast";
  title: string;
  thumbnail?: string;
  audioUrl?: string;
  /** a podcast episode's video twin, which the player prefers over audio */
  videoUrl?: string;
  autoOpen?: boolean;
  compact?: boolean;
  /** rendered above the row, spanning thumbnail and text (the box puts the show's kicker here) */
  header?: ReactNode;
  /** an explicit moment to start at (a story's "discussed at 12:34" link); beats the remembered playhead */
  startAt?: number;
  /** shown on the flat tile when the row has no thumbnail (the show's name) */
  tileText?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(autoOpen);
  // expanded: the same player element enlarged into an overlay on this page
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState(0);
  const [resumeAt, setResumeAt] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const ytId = videoUrl ? youtubeId(videoUrl) : kind === "video" ? youtubeId(url) : null;
  const memoryKey = ytId ?? (audioUrl ? `audio:${audioUrl}` : "");

  // the remembered spot is read on the client only (no storage on the server)
  useEffect(() => {
    if (startAt !== undefined && startAt > 0) setResumeAt(startAt);
    else if (memoryKey) setResumeAt(loadPos(memoryKey));
  }, [memoryKey, open, startAt]);
  const playable = Boolean(ytId || (kind === "podcast" && audioUrl));

  // Ask the YouTube player to stream its state, and keep the playhead. The
  // embed only talks once it is listening, so the handshake repeats briefly.
  useEffect(() => {
    if (!open || !ytId) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== YT_EMBED_ORIGIN || e.source !== frame.current?.contentWindow) return;
      try {
        const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        const t = data?.info?.currentTime;
        if (typeof t === "number" && Number.isFinite(t)) {
          setPosition(t);
          if (memoryKey) savePos(memoryKey, t, typeof data?.info?.duration === "number" ? data.info.duration : undefined);
        }
      } catch {
        // not ours
      }
    };
    window.addEventListener("message", onMessage);
    const say = (msg: object) => frame.current?.contentWindow?.postMessage(JSON.stringify(msg), YT_EMBED_ORIGIN);
    const handshake = window.setInterval(() => say({ event: "listening", id, channel: "widget" }), 1000);
    const stop = window.setTimeout(() => window.clearInterval(handshake), 8000);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(handshake);
      window.clearTimeout(stop);
    };
  }, [open, ytId, id, memoryKey]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [expanded]);
  useEffect(() => {
    if (!open) setExpanded(false);
  }, [open]);

  const seconds = Math.floor(position);
  const watchHref = ytId ? `https://www.youtube.com/watch?v=${ytId}${seconds > 5 ? `&t=${seconds}s` : ""}` : url;
  // leaving for YouTube (or the episode page) pauses the player here, so the
  // reader never has two copies running
  const pauseHere = () => {
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "pauseVideo", args: [] }), YT_EMBED_ORIGIN);
    audio.current?.pause();
  };

  const thumb = thumbnail ? (
    // remote thumbnails from many hosts; plain img keeps them out of the image optimizer
    // eslint-disable-next-line @next/next/no-img-element
    <img src={thumbnail} alt="" loading="lazy" />
  ) : null;

  return (
    <>
      {header}
      <div className="media-row">
        {playable ? (
          <button
            type="button"
            className={`media-thumb media-play${thumb ? "" : " no-thumb"}`}
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? `Close player for ${title}` : `Play ${title}`}
            aria-expanded={open}
            aria-controls={`player-${id}`}
          >
            {thumb}
            {!thumb && tileText ? <span className="tile-name">{tileText}</span> : null}
            <span className="play-mark" aria-hidden="true">
              {open ? "✕" : "▶"}
            </span>
            {!open && resumeAt > 0 ? (
              <span className="resume-mark" aria-hidden="true">
                {fmt(Math.floor(resumeAt))}
              </span>
            ) : null}
          </button>
        ) : thumb ? (
          <a href={url} rel="noopener" className="media-thumb" tabIndex={-1} aria-hidden="true">
            {thumb}
          </a>
        ) : null}
        {children}
      </div>
      {open && playable ? (
        <div
          className={`media-player${compact ? " compact" : ""}${expanded ? " expanded" : ""}`}
          id={`player-${id}`}
          onClick={(e) => {
            // clicking the dimmed backdrop (not the player itself) shrinks it back
            if (expanded && e.target === e.currentTarget) setExpanded(false);
          }}
        >
          <div className="media-player-inner">
            {ytId ? (
              <div className="media-frame">
                <iframe
                  ref={frame}
                  src={`${YT_EMBED_ORIGIN}/embed/${ytId}?autoplay=1&rel=0&enablejsapi=1${resumeAt > 0 ? `&start=${Math.floor(resumeAt)}` : ""}`}
                  title={title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            ) : (
              <audio
                ref={audio}
                controls
                autoPlay
                preload="none"
                src={audioUrl}
                onLoadedMetadata={(e) => {
                  if (resumeAt > 0) e.currentTarget.currentTime = resumeAt;
                }}
                onTimeUpdate={(e) => {
                  setPosition(e.currentTarget.currentTime);
                  if (memoryKey) savePos(memoryKey, e.currentTarget.currentTime, e.currentTarget.duration || undefined);
                }}
              />
            )}
            <div className="org media-player-links">
              <a href={watchHref} rel="noopener" onClick={pauseHere} onAuxClick={pauseHere}>
                {ytId ? (seconds > 5 ? `watch on YouTube from ${fmt(seconds)}` : "watch on YouTube") : "open episode page"}
              </a>{" "}
              ·{" "}
              <button type="button" className="linklike" onClick={() => setExpanded((v) => !v)}>
                {expanded ? "shrink" : "expand"}
              </button>{" "}
              ·{" "}
              <button type="button" className="linklike" onClick={() => setOpen(false)}>
                close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function fmt(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
