"use client";

import { useState } from "react";
import type { Listing, SponsoredPost } from "@/lib/types";
import { AdminChrome, type AdminChromeData, Toast, useAdminAct } from "../shared";

export interface SponsoredData {
  sections: string[];
  sponsorPageEnabled: boolean;
  sponsoredPosts: SponsoredPost[];
  jobs: Listing[];
  events: Listing[];
  podcasts: Listing[];
}

export function SponsoredClient({ chrome, data }: { chrome: AdminChromeData; data: SponsoredData }) {
  const { busy, status, setStatus, act } = useAdminAct();
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div>
      <AdminChrome chrome={chrome} />
      <Toast status={status} onClear={() => setStatus("")} />

      <p className="status-line">
        <label className="footer-pref" style={{ marginLeft: 0 }}>
          <input
            type="checkbox"
            checked={data.sponsorPageEnabled}
            disabled={busy}
            onChange={(e) => act("setSponsorPage", { enabled: e.target.checked })}
          />{" "}
          show the Sponsor page and its footer link
        </label>
      </p>

      <h2 id="sponsored">Sponsored posts</h2>
      <p className="status-line">
        The site shows the first “shown” post per placement. Extras can sit here hidden, queued for later.
      </p>
      {data.sponsoredPosts.map((p) => (
        <div key={p.id} className={`admin-card${p.hidden ? " is-hidden" : ""}`}>
          {editingId === p.id ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setEditingId(null);
                const placements = f.getAll("placements");
                act("editSponsored", {
                  id: p.id,
                  headline: f.get("headline"),
                  url: f.get("url"),
                  sponsor: f.get("sponsor"),
                  description: f.get("description"),
                  // the middle column shows everywhere, so it supersedes any mix
                  placements: placements.includes("sidebar") ? ["sidebar"] : placements,
                });
              }}
            >
              <div className="form-row">
                <input className="text" name="headline" defaultValue={p.headline} required />
                <input className="text" name="url" defaultValue={p.url} required />
                <input className="text" name="sponsor" defaultValue={p.sponsor ?? ""} placeholder="Sponsor name" />
                <input
                  className="text"
                  name="description"
                  defaultValue={p.description ?? ""}
                  placeholder="Description (reads like a story explainer)"
                  maxLength={280}
                />
                <span className="check-group">
                  {["top", ...data.sections, "sidebar"].map((s) => (
                    <label key={s} title={s === "sidebar" ? "Middle column, shows on every story page and overrides the others" : undefined}>
                      <input
                        type="checkbox"
                        name="placements"
                        value={s}
                        defaultChecked={(p.placements ?? [p.placement ?? "top"]).includes(s as never)}
                      />{" "}
                      {s === "top" ? "top stories" : s === "sidebar" ? "middle column" : s}
                    </label>
                  ))}
                </span>
                <button className="btn primary" type="submit" disabled={busy}>
                  Save
                </button>
                <button className="btn" type="button" onClick={() => setEditingId(null)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="headline">{p.headline}</div>
              {p.description ? (
                <div className="sub" style={{ fontStyle: "italic", margin: "2px 0 4px" }}>
                  {p.description}
                </div>
              ) : null}
              <div className="sub">
                {(p.placements ?? [p.placement ?? "top"]).join(", ")} {p.sponsor ? `· ${p.sponsor}` : ""} ·{" "}
                <a href={p.url}>{p.url}</a>
              </div>
              <div className="btn-row">
                <label className="shown-check">
                  <input
                    type="checkbox"
                    checked={!p.hidden}
                    disabled={busy}
                    onChange={() => act("toggleShown", { kind: "sponsoredPosts", id: p.id })}
                  />{" "}
                  shown
                </label>
                <button className="btn" disabled={busy} onClick={() => setEditingId(p.id)}>
                  Edit
                </button>
                <button className="btn danger" disabled={busy} onClick={() => act("removeSponsored", { id: p.id }, `Remove “${p.headline}”?`)}>
                  Remove
                </button>
              </div>
            </>
          )}
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const placements = f.getAll("placements");
          act("addSponsored", {
            headline: f.get("headline"),
            url: f.get("url"),
            sponsor: f.get("sponsor"),
            description: f.get("description"),
            placements: placements.includes("sidebar") ? ["sidebar"] : placements,
          });
          e.currentTarget.reset();
        }}
      >
        <div className="form-row">
          <input className="text" name="headline" placeholder="Headline" required />
          <input className="text" name="url" placeholder="URL" required />
          <input className="text" name="sponsor" placeholder="Sponsor name" />
          <input className="text" name="description" placeholder="Description (reads like a story explainer)" maxLength={280} />
          <span className="check-group">
            {["top", ...data.sections, "sidebar"].map((s) => (
              <label key={s} title={s === "sidebar" ? "Middle column, shows on every story page and overrides the others" : undefined}>
                <input type="checkbox" name="placements" value={s} defaultChecked={s === "top"} />{" "}
                {s === "top" ? "top stories" : s === "sidebar" ? "middle column" : s}
              </label>
            ))}
          </span>
          <button className="btn" type="submit" disabled={busy}>
            Add
          </button>
        </div>
      </form>

      {(["jobs", "events", "podcasts"] as const).map((kind) => (
        <div key={kind}>
          <h2 id={kind}>{kind === "podcasts" ? "Sponsored Podcasts" : kind.charAt(0).toUpperCase() + kind.slice(1)}</h2>
          {data[kind].map((l) => (
            <div key={l.id} className={`admin-card${l.hidden ? " is-hidden" : ""}`}>
              {editingId === l.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    setEditingId(null);
                    act("editListing", {
                      kind,
                      id: l.id,
                      title: f.get("title"),
                      url: f.get("url"),
                      org: f.get("org"),
                      date: f.get("date"),
                    });
                  }}
                >
                  <div className="form-row">
                    <input className="text" name="title" defaultValue={l.title} required />
                    <input className="text" name="url" defaultValue={l.url} required />
                    <input
                      className="text"
                      name="org"
                      defaultValue={l.org ?? ""}
                      placeholder={kind === "jobs" ? "Company" : kind === "events" ? "Organizer" : "Show"}
                    />
                    {kind === "events" ? (
                      <input className="text" name="date" defaultValue={l.date ?? ""} placeholder="Date" />
                    ) : null}
                    <button className="btn primary" type="submit" disabled={busy}>
                      Save
                    </button>
                    <button className="btn" type="button" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="headline">
                    {l.featured ? "★ " : ""}
                    {l.title} {l.org ? <span className="sub">· {l.org}</span> : null}
                  </div>
                  <div className="btn-row">
                    <label className="shown-check">
                      <input
                        type="checkbox"
                        checked={!l.hidden}
                        disabled={busy}
                        onChange={() => act("toggleShown", { kind, id: l.id })}
                      />{" "}
                      shown
                    </label>
                    <button className="btn" disabled={busy} onClick={() => setEditingId(l.id)}>
                      Edit
                    </button>
                    <button className="btn" disabled={busy} onClick={() => act("toggleFeatured", { kind, id: l.id })}>
                      {l.featured ? "Unfeature" : "Feature"}
                    </button>
                    <button
                      className="btn danger"
                      disabled={busy}
                      onClick={() => act("removeListing", { kind, id: l.id }, `Remove “${l.title}”?`)}
                    >
                      Remove
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              act("addListing", {
                kind,
                title: f.get("title"),
                url: f.get("url"),
                org: f.get("org"),
                date: f.get("date"),
                featured: f.get("featured") === "on",
              });
              e.currentTarget.reset();
            }}
          >
            <div className="form-row">
              <input className="text" name="title" placeholder="Title" required />
              <input className="text" name="url" placeholder="URL" required />
              <input
                className="text"
                name="org"
                placeholder={kind === "jobs" ? "Company" : kind === "events" ? "Organizer" : "Show"}
              />
              {kind === "events" ? <input className="text" name="date" placeholder="Date (e.g. Nov 17-19)" /> : null}
              <label style={{ alignSelf: "center", fontSize: "0.8rem" }}>
                <input type="checkbox" name="featured" /> featured
              </label>
              <button className="btn" type="submit" disabled={busy}>
                Add
              </button>
            </div>
          </form>
        </div>
      ))}
    </div>
  );
}
