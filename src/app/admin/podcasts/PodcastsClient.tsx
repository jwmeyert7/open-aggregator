"use client";

import type { MediaItem } from "@/lib/types";
import { timeAgo } from "@/lib/util";
import { AdminChrome, type AdminChromeData, Toast, useAdminAct } from "../shared";
import { useState } from "react";

export interface PodcastsData {
  sections: string[];
  mediaItems: MediaItem[];
}

export function PodcastsClient({
  chrome,
  data,
  initialEpisodeId,
}: {
  chrome: AdminChromeData;
  data: PodcastsData;
  /** the site's edit links land here: show exactly this episode until cleared */
  initialEpisodeId?: string;
}) {
  const { busy, status, setStatus, act } = useAdminAct();
  const [pinnedId, setPinnedId] = useState(initialEpisodeId);
  const shownItems = pinnedId ? data.mediaItems.filter((m) => m.id === pinnedId) : data.mediaItems;

  return (
    <div>
      <AdminChrome chrome={chrome} />
      <Toast status={status} onClear={() => setStatus("")} />

      <h2 id="media">Podcasts</h2>
      <p className="sub">
        Episodes the pipeline aggregated from whitelisted shows onto /podcasts, the front-page box, and each one's
        section box. Unchecking hides an episode from the site (it stays here until it ages out). Re-judge runs the
        current media gate over the tier 2 episodes already shelved, hiding any that no longer pass, and refreshes
        every episode's section label.
      </p>
      {/* editor override: one hand-picked episode straight onto the shelf, no gate */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const url = String(f.get("url") ?? "").trim();
          if (!url) return;
          act("addMediaUrl", { url, section: f.get("section") });
          e.currentTarget.reset();
        }}
      >
        <div className="form-row">
          <input className="text" name="url" placeholder="Add an episode by YouTube link (no gate)…" />
          <select className="select" name="section" style={{ width: "auto" }}>
            <option value="">no section label</option>
            {data.sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button className="btn" type="submit" disabled={busy}>
            Add episode
          </button>
        </div>
      </form>
      <div className="btn-row">
        <button className="btn" disabled={busy} onClick={() => act("refreshMedia")}>
          Refresh shelf now
        </button>
        <button className="btn" disabled={busy} onClick={() => act("rejudgeMedia")}>
          Re-judge shelf
        </button>
      </div>
      {pinnedId ? (
        <p className="status-line">
          Showing one episode, straight from its edit link.{" "}
          <button className="btn" onClick={() => setPinnedId(undefined)}>
            Show the shelf
          </button>
        </p>
      ) : null}
      {shownItems.length === 0 ? <p className="empty-state">Nothing on the shelf yet.</p> : null}
      {shownItems.map((m) => (
        <div key={m.id} className={`admin-card${m.hidden ? " is-hidden" : ""}`}>
          <div className="headline">
            <a href={m.url} rel="noopener" title={m.displayTitle ? `Show's title: ${m.title}` : undefined}>
              {m.displayTitle ?? m.title}
            </a>{" "}
            <span className="sub">
              · {m.sourceName} · {m.kind}
              {m.section ? <> · {m.section}</> : null}
              {m.durationSec ? <> · {Math.round(m.durationSec / 60)}m</> : null}
              {m.views ? <> · {m.views >= 1000 ? `${(m.views / 1000).toFixed(m.views >= 10000 ? 0 : 1)}k` : m.views} views</> : null} · {timeAgo(m.publishedAt)}
            </span>
          </div>
          <div className="btn-row">
            <label className="shown-check">
              <input
                type="checkbox"
                checked={!m.hidden}
                disabled={busy}
                onChange={() => act("toggleMediaHidden", { id: m.id })}
              />{" "}
              shown
            </label>
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                const title = new FormData(e.currentTarget).get("title") as string;
                act("setMediaTitle", { id: m.id, title });
              }}
            >
              <input
                className="text"
                name="title"
                defaultValue={m.displayTitle ?? ""}
                placeholder="Site title (optional, the show's title stays in the tooltip)"
              />
              <button className="btn" type="submit" disabled={busy}>
                Set title
              </button>
            </form>
          </div>
        </div>
      ))}
    </div>
  );
}
