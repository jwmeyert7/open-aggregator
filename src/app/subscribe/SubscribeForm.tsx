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
              monthly: f.get("monthly") === "on",
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
      <input className="text" type="email" name="email" placeholder="you@example.com" required />
      {/* honeypot: hidden from people, tempting to bots */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px" }} />
      <div className="subscribe-checks">
        <label className="shown-check">
          <input type="checkbox" name="daily" /> daily
        </label>
        <label className="shown-check">
          <input type="checkbox" name="weekly" defaultChecked /> weekly
        </label>
        <label className="shown-check">
          <input type="checkbox" name="monthly" /> monthly
        </label>
      </div>
      <button className="btn primary" type="submit" disabled={busy}>
        Sign up
      </button>
      {status ? <p className="status-line">{status}</p> : null}
    </form>
  );
}
