"use client";

import { useState } from "react";

export function SubmitForm({ story }: { story?: string }) {
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, note, email, story, website }),
      });
      const json = await res.json();
      setStatus({ ok: Boolean(json.ok), message: json.message ?? "Something went wrong." });
      if (json.ok) {
        setUrl("");
        setNote("");
      }
    } catch {
      setStatus({ ok: false, message: "Network error. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="submit-form">
      <label>
        Link *
        <input
          type="url"
          required
          placeholder="https://example.com/the-post"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <label>
        Why it&apos;s notable <span className="org">(optional)</span>
        <textarea
          rows={3}
          maxLength={500}
          placeholder="Only needed if it isn't obvious."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <label>
        Your email <span className="org">(optional, never shown)</span>
        <input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      {/* honeypot: hidden from people, filled by bots */}
      <label className="hp-field" aria-hidden="true">
        Website
        <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </label>
      <button type="submit" disabled={busy || !url.trim()}>
        {busy ? "Sending…" : "Suggest it"}
      </button>
      {status ? <p className={status.ok ? "form-ok" : "form-err"}>{status.message}</p> : null}
    </form>
  );
}
