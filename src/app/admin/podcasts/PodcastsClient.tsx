"use client";

import type { MediaItem } from "@/lib/types";
import { timeAgo } from "@/lib/util";
import { AdminChrome, type AdminChromeData, Toast, useAdminAct } from "../shared";

export interface PodcastsData {
  mediaItems: MediaItem[];
}

export function PodcastsClient({ chrome, data }: { chrome: AdminChromeData; data: PodcastsData }) {
  const { busy, status, setStatus, act } = useAdminAct();

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
      <div className="btn-row">
        <button className="btn" disabled={busy} onClick={() => act("refreshMedia")}>
          Refresh shelf now
        </button>
        <button className="btn" disabled={busy} onClick={() => act("rejudgeMedia")}>
          Re-judge shelf
        </button>
      </div>
      {data.mediaItems.length === 0 ? <p className="empty-state">Nothing on the shelf yet.</p> : null}
      {data.mediaItems.map((m) => (
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
