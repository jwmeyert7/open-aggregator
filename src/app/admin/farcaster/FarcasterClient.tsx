"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { timeAgo } from "@/lib/util";

export interface FcCast {
  hash: string;
  text: string;
  timestamp: string;
  likes: number;
  replies: number;
}

export interface FcNotification {
  type: string;
  author: string;
  text: string;
  hash: string;
  timestamp: string;
}

async function call(action: string, payload: Record<string, unknown> = {}) {
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  return (await res.json().catch(() => ({ ok: false, message: "Bad response" }))) as {
    ok: boolean;
    message?: string;
    url?: string;
  };
}

export function FarcasterClient({
  username,
  casts,
  notifications,
}: {
  username: string | null;
  casts: FcCast[];
  notifications: FcNotification[];
}) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");

  async function act(action: string, payload: Record<string, unknown> = {}, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setStatus("Working…");
    const res = await call(action, payload);
    setStatus(res.url ? `${res.message} ${res.url}` : res.message || (res.ok ? "Done." : "Failed."));
    setBusy(false);
    if (res.ok) router.refresh();
    return res;
  }

  return (
    <div>
      {status ? (
        <div className="notice toast" onClick={() => setStatus("")} title="Dismiss">
          {status}
        </div>
      ) : null}

      <h2>Cast</h2>
      <p className="status-line">Casts are immutable on Farcaster: no edits, only delete and repost.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          const res = await act("fcCast", { text: draft.trim() });
          if (res?.ok) setDraft("");
        }}
      >
        <textarea
          className="text"
          rows={3}
          maxLength={1024}
          placeholder={username ? `Cast as @${username}…` : "Cast…"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ width: "100%", resize: "vertical" }}
        />
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button className="btn primary" type="submit" disabled={busy || !draft.trim()}>
            Cast
          </button>
          <span className="status-line">{draft.length}/1024</span>
        </div>
      </form>

      <h2>Mentions &amp; replies</h2>
      {notifications.length === 0 ? <p className="empty-state">Nothing yet.</p> : null}
      {notifications.map((n) => (
        <div key={n.hash} className="admin-card">
          <div className="sub">
            <strong>@{n.author}</strong> · {n.type}
            {n.timestamp ? ` · ${timeAgo(n.timestamp)}` : ""} ·{" "}
            <a href={`https://farcaster.xyz/${n.author}/${n.hash.slice(0, 10)}`} rel="noopener">
              view
            </a>
          </div>
          <div style={{ margin: "6px 0" }}>{n.text}</div>
          <div className="btn-row">
            <button className="btn" disabled={busy} onClick={() => act("fcLike", { hash: n.hash })}>
              Like
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                setReplyTo(replyTo === n.hash ? null : n.hash);
                setReplyDraft("");
              }}
            >
              Reply
            </button>
          </div>
          {replyTo === n.hash ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!replyDraft.trim()) return;
                const res = await act("fcCast", { text: replyDraft.trim(), parent: n.hash });
                if (res?.ok) {
                  setReplyTo(null);
                  setReplyDraft("");
                }
              }}
            >
              <div className="form-row">
                <input
                  className="text"
                  placeholder={`Reply to @${n.author}…`}
                  value={replyDraft}
                  onChange={(e) => setReplyDraft(e.target.value)}
                  maxLength={1024}
                />
                <button className="btn primary" type="submit" disabled={busy || !replyDraft.trim()}>
                  Send
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ))}

      <h2>Our casts</h2>
      {casts.length === 0 ? <p className="empty-state">No casts yet.</p> : null}
      {casts.map((c) => (
        <div key={c.hash} className="admin-card">
          <div style={{ marginBottom: 6 }}>{c.text}</div>
          <div className="sub">
            {c.timestamp ? `${timeAgo(c.timestamp)} · ` : ""}
            {c.likes} like{c.likes === 1 ? "" : "s"} · {c.replies} repl{c.replies === 1 ? "y" : "ies"}
            {username ? (
              <>
                {" · "}
                <a href={`https://farcaster.xyz/${username}/${c.hash.slice(0, 10)}`} rel="noopener">
                  view on Farcaster
                </a>
              </>
            ) : null}
          </div>
          <div className="btn-row">
            <button
              className="btn danger"
              disabled={busy}
              onClick={() => act("fcDelete", { hash: c.hash }, "Delete this cast? This can't be undone.")}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
