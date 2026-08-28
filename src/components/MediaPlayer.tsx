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

const PS_SUFFIX = ":state";
function savePlayState(key: string, state: number): void {
  try {
    window.localStorage.setItem(POS_KEY + key + PS_SUFFIX, String(state));
  } catch {}
}
/** 1 = playing, 2 = paused. Defaults to playing so a fresh detach starts. */
export function loadPlayState(key: string): number {
  try {
    const v = Number(window.localStorage.getItem(POS_KEY + key + PS_SUFFIX));
    return v === 2 ? 2 : 1;
  } catch {
    return 1;
  }
}
export function loadPlayhead(key: string): number {
  return loadPos(key);
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
  durationSec,
  popOut = true,
  detach = false,
  closeWindow = false,
  onClose,
  chapters,
  startPaused = false,
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
  /** episode length: shown on the thumbnail chip, after the resume point when one is saved */
  durationSec?: number;
  /** offer the pop-out control that hands playback to the corner dock */
  popOut?: boolean;
  /** dock only: offer the float (picture-in-picture) and window detach controls */
  detach?: boolean;
  /** the player is the whole window (the /player popup page, or the float's inner frame): close closes the window itself */
  closeWindow?: boolean;
  /** dock: close dismisses the whole dock instead of leaving a player-less stub */
  onClose?: () => void;
  /** the episode's chapter marks; the dock and detached windows render them as one-tap jumps */
  chapters?: Array<{ at: number; label: string }>;
  /** open with the player loaded at its second but not playing (a detach that was paused stays paused) */
  startPaused?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(autoOpen);
  // expanded: the same player element enlarged into an overlay on this page
  const [expanded, setExpanded] = useState(false);
  // direct-file episodes with an audio rendition: the reader may swap the
  // heavy video for the light audio (and back), keeping the playhead
  const [audioOnly, setAudioOnly] = useState(false);
  const [position, setPosition] = useState(0);
  const [resumeAt, setResumeAt] = useState(0);
  // total length: seeded from the shelf's data, refined by the player itself
  const [dur, setDur] = useState(durationSec ?? 0);
  const frame = useRef<HTMLIFrameElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const fileFrame = useRef<HTMLVideoElement>(null);
  /** how many pixels the detached window grew for the open chapter list */
  const chapterGrow = useRef(0);
  const ytId = videoUrl ? youtubeId(videoUrl) : kind === "video" ? youtubeId(url) : null;
  // a non-YouTube videoUrl is a direct video file (an IPFS-pinned mp4, say),
  // played in a native video element instead of an embed
  const fileVideo = !ytId && videoUrl ? videoUrl : null;
  const memoryKey = ytId ?? (fileVideo ? `video:${fileVideo}` : audioUrl ? `audio:${audioUrl}` : "");

  // the remembered spot is read on the client only (no storage on the server)
  useEffect(() => {
    if (startAt !== undefined && startAt > 0) setResumeAt(startAt);
    else if (memoryKey) setResumeAt(loadPos(memoryKey));
  }, [memoryKey, open, startAt]);
  const playable = Boolean(ytId || fileVideo || (kind === "podcast" && audioUrl));

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
          const d = data?.info?.duration;
          if (typeof d === "number" && Number.isFinite(d) && d > 0) setDur(d);
          const ps = data?.info?.playerState;
          if (typeof ps === "number" && memoryKey) savePlayState(memoryKey, ps === 1 || ps === 3 ? 1 : 2);
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
    fileFrame.current?.pause();
  };

  const pipSupported = typeof window !== "undefined" && "documentPictureInPicture" in window;

  // pop out: hand playback to the corner dock (mounted in the layout) at the
  // current second, then close here so only one copy plays
  const toDock = () => {
    window.dispatchEvent(
      new CustomEvent("podcast:dock", {
        detail: { url, kind, title, audioUrl, videoUrl, chapters, startAt: Math.floor(position) },
      })
    );
    pauseHere();
    setOpen(false);
  };

  // detach: the dock owns the windows (it must hide while one is open and
  // return when the window closes), so these just announce the wish with the
  // honest second and the current play state
  const detachTo = (mode: "float" | "window") => {
    if (!ytId && !fileVideo) return;
    const at = seconds > 0 ? seconds : Math.floor(resumeAt);
    const paused = memoryKey ? loadPlayState(memoryKey) !== 1 : false;
    window.dispatchEvent(
      new CustomEvent("podcast:detach", {
        detail: { mode, ytId: ytId ?? undefined, fileUrl: fileVideo ?? undefined, at, paused, title },
      })
    );
    pauseHere();
  };
  const toFloat = () => detachTo("float");
  const toWindow = () => detachTo("window");

  const seekTo = (at: number) => {
    if (ytId) {
      frame.current?.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func: "seekTo", args: [at, true] }),
        YT_EMBED_ORIGIN
      );
    } else if (fileFrame.current) {
      fileFrame.current.currentTime = at;
    } else if (audio.current) {
      audio.current.currentTime = at;
    }
  };

  // in a detached window the player is the window: closing one closes both.
  // Inside the float, the /player page is an iframe, so the window to close
  // is the parent picture-in-picture window.
  const closePlayer = () => {
    if (onClose) {
      onClose();
      return;
    }
    if (closeWindow) {
      const w = window.parent === window ? window : window.parent;
      try {
        w.close();
      } catch {}
      return;
    }
    setOpen(false);
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
            {!open && (resumeAt > 0 || durationSec) ? (
              <span className="resume-mark" aria-hidden="true">
                {resumeAt > 0 && durationSec
                  ? `${fmt(Math.floor(resumeAt))} / ${fmt(Math.round(durationSec))}`
                  : resumeAt > 0
                    ? fmt(Math.floor(resumeAt))
                    : fmt(Math.round(durationSec ?? 0))}
              </span>
            ) : null}
            {!open && resumeAt > 0 && durationSec ? (
              <span
                className="watch-bar"
                aria-hidden="true"
                style={{ width: `${Math.min(100, (resumeAt / durationSec) * 100)}%` }}
              />
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
                  src={`${YT_EMBED_ORIGIN}/embed/${ytId}?autoplay=${startPaused ? 0 : 1}&rel=0&enablejsapi=1${resumeAt > 0 ? `&start=${Math.floor(resumeAt)}` : ""}`}
                  title={title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            ) : fileVideo && !audioOnly ? (
              <div className="media-frame">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video
                  ref={fileFrame}
                  controls
                  autoPlay={!startPaused}
                  preload="metadata"
                  playsInline
                  src={fileVideo}
                  poster={thumbnail}
                  onPlay={() => memoryKey && savePlayState(memoryKey, 1)}
                  onPause={() => memoryKey && savePlayState(memoryKey, 2)}
                  onLoadedMetadata={(e) => {
                    if (resumeAt > 0) e.currentTarget.currentTime = resumeAt;
                  }}
                  onTimeUpdate={(e) => {
                    setPosition(e.currentTarget.currentTime);
                    if (Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0) setDur(e.currentTarget.duration);
                    if (memoryKey) savePos(memoryKey, e.currentTarget.currentTime, e.currentTarget.duration || undefined);
                  }}
                />
              </div>
            ) : (
              <audio
                ref={audio}
                controls
                autoPlay={!startPaused}
                preload="none"
                src={audioUrl}
                onPlay={() => memoryKey && savePlayState(memoryKey, 1)}
                onPause={() => memoryKey && savePlayState(memoryKey, 2)}
                onLoadedMetadata={(e) => {
                  if (resumeAt > 0) e.currentTarget.currentTime = resumeAt;
                }}
                onTimeUpdate={(e) => {
                  setPosition(e.currentTarget.currentTime);
                  if (Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0) setDur(e.currentTarget.duration);
                  if (memoryKey) savePos(memoryKey, e.currentTarget.currentTime, e.currentTarget.duration || undefined);
                }}
              />
            )}
            <div className="org media-player-links">
              <a href={watchHref} rel="noopener" onClick={pauseHere} onAuxClick={pauseHere}>
                {ytId
                ? seconds > 0
                  ? `watch on YouTube from ${fmt(seconds)} / ${dur > 0 ? `${fmt(Math.round(dur))} (${Math.min(100, Math.round((seconds / dur) * 100))}%)` : "…"}`
                  : "watch on YouTube"
                : "open episode page"}
              </a>{" "}
              ·{" "}
              <button type="button" className="linklike" onClick={() => setExpanded((v) => !v)}>
                {expanded ? "shrink" : "expand"}
              </button>{" "}
              {fileVideo && audioUrl ? (
                <>
                  ·{" "}
                  <button
                    type="button"
                    className="linklike"
                    title={audioOnly ? "Back to the video" : "Audio only: a far smaller download than the raw video file"}
                    onClick={() => {
                      if (position > 0) setResumeAt(Math.floor(position));
                      pauseHere();
                      setAudioOnly((v) => !v);
                    }}
                  >
                    {audioOnly ? "watch video" : "listen instead"}
                  </button>{" "}
                </>
              ) : null}
              {popOut ? (
                <>
                  ·{" "}
                  <button type="button" className="linklike" onClick={toDock} title="Keep playing in a corner dock while you browse the site">
                    pop out
                  </button>{" "}
                </>
              ) : null}
              {detach && (ytId || fileVideo) ? (
                <>
                  ·{" "}
                  {pipSupported ? (
                    <>
                      <button type="button" className="linklike" onClick={toFloat} title="An always-on-top mini window (replaces any other floating window you have)">
                        float
                      </button>{" "}
                      ·{" "}
                    </>
                  ) : null}
                  <button type="button" className="linklike" onClick={toWindow} title="A separate small browser window">
                    window
                  </button>{" "}
                </>
              ) : null}
              ·{" "}
              <button type="button" className="linklike" onClick={closePlayer}>
                close
              </button>
            </div>
          {chapters && chapters.length > 0 ? (
            <details
              className="player-chapters"
              onToggle={(e) => {
                // In a detached player window (popup, or the /player frame
                // inside the document PiP window) the flex layout would shrink
                // the video to make room for the list. Grow the window by the
                // list's height instead, and pull it back on collapse. Where
                // the browser refuses the resize, the old squeeze stands.
                const el = e.currentTarget;
                if (!document.querySelector(".player-page")) return;
                try {
                  const host = window.parent !== window ? window.parent : window;
                  if (el.open) {
                    const wanted = Math.ceil(el.querySelector("ol")?.getBoundingClientRect().height ?? 0);
                    const room = Math.max(0, (window.screen?.availHeight ?? 900) - host.outerHeight - 24);
                    const grow = Math.min(wanted, room);
                    if (grow > 0) {
                      host.resizeBy(0, grow);
                      chapterGrow.current = grow;
                    }
                  } else if (chapterGrow.current > 0) {
                    host.resizeBy(0, -chapterGrow.current);
                    chapterGrow.current = 0;
                  }
                } catch {
                  chapterGrow.current = 0;
                }
              }}
            >
              <summary>chapters ({chapters.length})</summary>
              <ol>
                {chapters.map((c) => (
                  <li key={c.at}>
                    <button type="button" className="linklike" onClick={() => seekTo(c.at)}>
                      <span className="chap-at">{fmt(c.at)}</span>
                      {c.label}
                    </button>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
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
