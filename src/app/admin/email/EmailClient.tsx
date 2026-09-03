"use client";

import { useState } from "react";
import { timeAgo } from "@/lib/util";
import { AdminChrome, type AdminChromeData, Toast, useAdminAct } from "../shared";

export interface EmailData {
  subscribers: { daily: number; weekly: number };
  emailSubscribers: Array<{ email: string; daily: boolean; weekly: boolean; monthly: boolean; confirmed: boolean; addedAt: string }>;
  /** newest "<kind> email: N/M sent" run-log note per cadence */
  sendHealth: Array<{ kind: string; at: string; note: string }>;
}

/** ISO week key (YYYY-Www) for the signup growth bars. */
function weekKey(iso: string): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function EmailClient({ chrome, data }: { chrome: AdminChromeData; data: EmailData }) {
  const { busy, status, setStatus, act } = useAdminAct();
  const [preview, setPreview] = useState<"daily" | "weekly" | "monthly" | null>(null);
  const [addEmail, setAddEmail] = useState("");
  const [addFlags, setAddFlags] = useState({ daily: true, weekly: false, monthly: false });
  const [hideUnconfirmed, setHideUnconfirmed] = useState(true);

  const subs = [...data.emailSubscribers].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  const confirmed = subs.filter((s) => s.confirmed);
  const monthlyCount = confirmed.filter((s) => s.monthly).length;
  const staleUnconfirmed = subs.filter(
    (s) => !s.confirmed && Date.now() - new Date(s.addedAt).getTime() > 30 * 24 * 60 * 60000
  ).length;

  // signups per week, oldest to newest, confirmed shading the honest metric
  const weeks = new Map<string, { all: number; confirmed: number }>();
  for (const s of subs) {
    const k = weekKey(s.addedAt);
    const w = weeks.get(k) ?? { all: 0, confirmed: 0 };
    w.all += 1;
    if (s.confirmed) w.confirmed += 1;
    weeks.set(k, w);
  }
  const weekRows = [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const maxWeek = Math.max(1, ...weekRows.map(([, w]) => w.all));

  const copyCsv = () => {
    const csv = [
      "email,daily,weekly,monthly,confirmed,addedAt",
      ...subs.map((s) => [s.email, s.daily, s.weekly, s.monthly, s.confirmed, s.addedAt].join(",")),
    ].join("\n");
    navigator.clipboard.writeText(csv).then(
      () => setStatus(`Copied ${subs.length} subscriber${subs.length === 1 ? "" : "s"} as CSV.`),
      () => setStatus("Could not reach the clipboard.")
    );
  };

  return (
    <div>
      <AdminChrome chrome={chrome} />
      <Toast status={status} onClear={() => setStatus("")} />

      <h2 id="email">Email digests</h2>
      <p className="status-line">
        <strong>{confirmed.length} confirmed</strong> ({subs.length - confirmed.length} unconfirmed) ·{" "}
        {data.subscribers.daily} daily / {data.subscribers.weekly} weekly / {monthlyCount} monthly. New signups receive
        nothing until they click their confirmation link.
      </p>

      {/* the quarter's metric gets its trajectory: signups per week, the solid
          part confirmed, the faint part still waiting on the click */}
      {weekRows.length > 0 ? (
        <div className="email-growth">
          {weekRows.map(([k, w]) => (
            <div key={k} className="email-growth-col" title={`week of ${k}: ${w.all} signup${w.all === 1 ? "" : "s"}, ${w.confirmed} confirmed`}>
              <div className="email-growth-bar">
                <div className="all" style={{ height: `${(w.all / maxWeek) * 48}px` }} />
                <div className="conf" style={{ height: `${(w.confirmed / maxWeek) * 48}px` }} />
              </div>
              <div className="email-growth-label">{k.slice(5)}</div>
            </div>
          ))}
        </div>
      ) : null}

      {data.sendHealth.length > 0 ? (
        <p className="status-line">
          {data.sendHealth.map((h) => (
            <span key={h.kind}>
              {h.note} ({timeAgo(h.at)}){" · "}
            </span>
          ))}
          from the run log
        </p>
      ) : (
        <p className="status-line">No email sends in the recent run log yet.</p>
      )}

      <div className="btn-row" style={{ marginBottom: 10 }}>
        <button className="btn" disabled={busy} onClick={() => act("testDigestEmail", { kind: "daily" })}>
          Email me the latest daily
        </button>
        <button className="btn" disabled={busy} onClick={() => act("testDigestEmail", { kind: "weekly" })}>
          Email me the weekly
        </button>
        <button className="btn" disabled={busy} onClick={() => act("testDigestEmail", { kind: "monthly" })}>
          Email me the monthly
        </button>
        {(["daily", "weekly", "monthly"] as const).map((k) => (
          <button key={k} className="btn" onClick={() => setPreview((v) => (v === k ? null : k))}>
            {preview === k ? `Hide ${k} preview` : `Preview ${k}`}
          </button>
        ))}
        <button className="btn" onClick={copyCsv} title="The whole list to the clipboard, spreadsheet-ready">
          Copy CSV
        </button>
        {staleUnconfirmed > 0 ? (
          <button
            className="btn danger"
            disabled={busy}
            onClick={() => act("pruneUnconfirmed", {}, `Remove ${staleUnconfirmed} unconfirmed signup(s) older than 30 days?`)}
          >
            Prune {staleUnconfirmed} stale unconfirmed
          </button>
        ) : null}
      </div>

      {preview ? (
        <iframe
          src={`/admin/email/preview/${preview}`}
          title={`${preview} email preview`}
          className="email-preview"
        />
      ) : null}

      <form
        className="form-row"
        style={{ margin: "10px 0" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!addEmail.trim()) return;
          act("addSubscriber", { email: addEmail.trim(), ...addFlags });
          setAddEmail("");
        }}
      >
        <input
          className="text"
          type="email"
          placeholder="Add a subscriber by hand (counts as confirmed)"
          value={addEmail}
          onChange={(e) => setAddEmail(e.target.value)}
        />
        {(["daily", "weekly", "monthly"] as const).map((k) => (
          <label key={k} className="kind-check">
            <input
              type="checkbox"
              checked={addFlags[k]}
              onChange={(e) => setAddFlags((f) => ({ ...f, [k]: e.target.checked }))}
            />{" "}
            {k}
          </label>
        ))}
        <button className="btn" type="submit" disabled={busy || !addEmail.trim()}>
          Add
        </button>
      </form>

      <div className="source-filters">
        <span className="filter-label">Show</span>
        <button type="button" className={`filter-chip${hideUnconfirmed ? " on" : ""}`} onClick={() => setHideUnconfirmed(true)}>
          confirmed ({confirmed.length})
        </button>
        <button type="button" className={`filter-chip${hideUnconfirmed ? "" : " on"}`} onClick={() => setHideUnconfirmed(false)}>
          everyone ({subs.length})
        </button>
      </div>

      {(hideUnconfirmed ? confirmed : subs).map((s) => (
        <div key={s.email} className="admin-card">
          <div className="sub">
            <strong>{s.email}</strong> · {s.confirmed ? "confirmed" : <span className="health-bad">unconfirmed</span>} · joined{" "}
            {timeAgo(s.addedAt)}
          </div>
          <div className="sub subscriber-controls">
            {/* each frequency is a chip that flips on click: selective removal
                without another button per frequency */}
            {(["daily", "weekly", "monthly"] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`filter-chip${s[k] ? " on" : ""}`}
                disabled={busy}
                title={s[k] ? `Click to stop the ${k} for ${s.email}` : `Click to add the ${k} for ${s.email}`}
                onClick={() => act("setSubscriberFlags", { email: s.email, [k]: !s[k] })}
              >
                {k}
              </button>
            ))}
            <span className="sub-sep">send now:</span>
            {(["daily", "weekly", "monthly"] as const).map((k) => (
              <button
                key={k}
                type="button"
                className="linklike"
                disabled={busy}
                onClick={() => act("testDigestEmail", { kind: k, email: s.email }, `Send the ${k} edition to ${s.email}?`)}
              >
                {k}
              </button>
            ))}
            <button
              className="linklike danger-text"
              disabled={busy}
              onClick={() => act("removeSubscriber", { email: s.email }, `Remove ${s.email} from every list?`)}
            >
              remove
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
