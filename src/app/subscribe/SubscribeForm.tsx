"use client";

import { useState } from "react";

export function SubscribeForm() {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="subscribe-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setStatus("Working…");
        try {
          const res = await fetch("/api/subscribe", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              email: f.get("email"),
              daily: f.get("daily") === "on",
              weekly: f.get("weekly") === "on",
              website: f.get("website"),
            }),
          });
          const json = (await res.json().catch(() => null)) as { message?: string } | null;
          setStatus(json?.message ?? "Something went wrong. Try again.");
        } catch {
          setStatus("Something went wrong. Try again.");
        }
        setBusy(false);
      }}
    >
      <div className="form-row">
        <input className="text" type="email" name="email" placeholder="you@example.com" required />
        {/* honeypot: hidden from people, tempting to bots */}
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px" }} />
        <button className="btn primary" type="submit" disabled={busy}>
          Sign up
        </button>
      </div>
      <div className="form-row subscribe-checks">
        <label className="shown-check">
          <input type="checkbox" name="daily" /> daily
        </label>
        <label className="shown-check">
          <input type="checkbox" name="weekly" defaultChecked /> weekly
        </label>
      </div>
      {status ? <p className="status-line">{status}</p> : null}
    </form>
  );
}
