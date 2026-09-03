"use client";

import { useState } from "react";
import { AdminChrome, type AdminChromeData, Toast, useAdminAct } from "../shared";

export interface EditionsData {
  sections: string[];
  list: Array<{ date: string; stories: number; version: number; attested: boolean; corrections: number }>;
  editing: null | {
    date: string;
    version: number;
    contentHash: string;
    attestationUid: string | null;
    corrections: Array<{ version: number; at: string; note: string; contentHash: string; supersedes: string; attestationUid?: string }>;
    stories: Array<{
      id: string;
      headline: string;
      explainer: string;
      section: string;
      source: string;
      live: { headline: string; explainer: string; section: string; killed: boolean } | null;
    }>;
  };
}

type Draft = { headline: string; explainer: string; section: string; remove: boolean };

export function EditionsClient({ chrome, data }: { chrome: AdminChromeData; data: EditionsData }) {
  const { busy, status, setStatus, act } = useAdminAct();
  const e = data.editing;
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries((e?.stories ?? []).map((s) => [s.id, { headline: s.headline, explainer: s.explainer, section: s.section, remove: false }]))
  );
  const [note, setNote] = useState("");

  const changes = (e?.stories ?? []).flatMap((s) => {
    const d = drafts[s.id];
    if (!d) return [];
    if (d.remove) return [{ id: s.id, remove: true }];
    const out: { id: string; headline?: string; explainer?: string; section?: string } = { id: s.id };
    if (d.headline.trim() !== s.headline) out.headline = d.headline;
    if (d.explainer.trim() !== s.explainer) out.explainer = d.explainer;
    if (d.section !== s.section) out.section = d.section;
    return Object.keys(out).length > 1 ? [out] : [];
  });

  return (
    <div>
      <AdminChrome chrome={chrome} />
      <Toast status={status} onClear={() => setStatus("")} />

      <h2 id="editions">Editions</h2>
      <p className="status-line">
        Frozen days and their corrections. A correction never edits the sealed file: it publishes a new version with
        its own sha256 and its own attestation on Base that names the one it replaced, and the earlier version stays
        on the day page. Any change at all is a correction, so the note is required and becomes part of the record.
        Reasons that qualify: a factual error, a story killed or merged later, a wrong source or dead link, a wrong
        section. Rewording and re-ranking do not.
      </p>

      {e ? (
        <div className="admin-card edition-edit">
          <div className="headline">
            {e.date} · version {e.version} · sha256 {e.contentHash.slice(0, 16)}…
            {e.attestationUid ? (
              <>
                {" · "}
                <a href={`https://base.easscan.org/attestation/view/${e.attestationUid}`} rel="noopener">
                  attestation
                </a>
              </>
            ) : (
              " · not yet attested"
            )}
            {" · "}
            <a href={`/day/${e.date}`}>day page</a> · <a href="/admin/editions">all editions</a>
          </div>
          {e.corrections.length > 0 ? (
            <div className="sub" style={{ marginTop: 6 }}>
              {e.corrections.map((c) => (
                <div key={c.version}>
                  v{c.version} · {c.at.slice(0, 16).replace("T", " ")} UTC · {c.note}
                </div>
              ))}
            </div>
          ) : null}

          {e.stories.map((s) => {
            const d = drafts[s.id];
            return (
              <div key={s.id} className="admin-card" style={{ marginTop: 10, opacity: d.remove ? 0.55 : 1 }}>
                <div className="sub">
                  {s.source} · {s.id}
                  {s.live ? (
                    <>
                      {" · "}
                      <button
                        type="button"
                        className="linklike"
                        title={`Live story now reads: ${s.live.headline}`}
                        onClick={() =>
                          setDrafts((prev) => ({
                            ...prev,
                            [s.id]: { ...prev[s.id], headline: s.live!.headline, explainer: s.live!.explainer, section: s.live!.section },
                          }))
                        }
                      >
                        use the live story&apos;s current text{s.live.killed ? " (live story is killed)" : ""}
                      </button>
                    </>
                  ) : null}
                </div>
                <input
                  className="text"
                  value={d.headline}
                  disabled={d.remove}
                  onChange={(ev) => setDrafts((prev) => ({ ...prev, [s.id]: { ...prev[s.id], headline: ev.target.value } }))}
                  style={{ width: "100%", marginTop: 6 }}
                />
                <textarea
                  className="text"
                  value={d.explainer}
                  disabled={d.remove}
                  onChange={(ev) => setDrafts((prev) => ({ ...prev, [s.id]: { ...prev[s.id], explainer: ev.target.value } }))}
                  style={{ marginTop: 6 }}
                />
                <div className="btn-row" style={{ marginTop: 6 }}>
                  <select
                    className="select"
                    value={d.section}
                    disabled={d.remove}
                    onChange={(ev) => setDrafts((prev) => ({ ...prev, [s.id]: { ...prev[s.id], section: ev.target.value } }))}
                    style={{ width: "auto" }}
                  >
                    {[...new Set([...data.sections, "general", s.section])].map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                  <label className="shown-check">
                    <input
                      type="checkbox"
                      checked={d.remove}
                      onChange={(ev) => setDrafts((prev) => ({ ...prev, [s.id]: { ...prev[s.id], remove: ev.target.checked } }))}
                    />{" "}
                    remove from this edition
                  </label>
                </div>
              </div>
            );
          })}

          <div style={{ marginTop: 12 }}>
            <div className="sub">
              {changes.length === 0 ? "No changes yet." : `${changes.length} change${changes.length === 1 ? "" : "s"} pending.`} The note
              below is published with the correction, in the file and on the day page.
            </div>
            <textarea
              className="text"
              placeholder="What changed and why (required, at least a sentence)"
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
              style={{ marginTop: 6 }}
            />
            <div className="btn-row" style={{ marginTop: 6 }}>
              <button
                className="btn primary"
                disabled={busy || changes.length === 0 || note.trim().length < 8}
                onClick={() =>
                  act(
                    "correctEdition",
                    { date: e.date, note: note.trim(), edits: changes },
                    `Publish version ${e.version + 1} of ${e.date} with ${changes.length} change${changes.length === 1 ? "" : "s"}? This seals a new file on Base and cannot be undone (only corrected again).`
                  )
                }
              >
                Publish correction as version {e.version + 1}
              </button>
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  setDrafts(Object.fromEntries(e.stories.map((s) => [s.id, { headline: s.headline, explainer: s.explainer, section: s.section, remove: false }])));
                  setNote("");
                }}
              >
                Discard changes
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="admin-card">
        <div className="headline">Frozen days</div>
        {data.list.length === 0 ? <div className="sub">No frozen editions yet.</div> : null}
        {data.list.map((d) => (
          <div key={d.date} className="sub" style={{ margin: "4px 0" }}>
            <a href={`/admin/editions?date=${d.date}`}>{d.date}</a> · {d.stories} stories · v{d.version}
            {d.corrections > 0 ? ` · ${d.corrections} correction${d.corrections === 1 ? "" : "s"}` : ""}
            {d.attested ? " · attested" : " · not attested"} · <a href={`/day/${d.date}`}>day page</a>
          </div>
        ))}
      </div>
    </div>
  );
}
