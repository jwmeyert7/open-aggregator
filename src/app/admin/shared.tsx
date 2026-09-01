"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Shared plumbing for the admin tool pages. Each tool lives on its own page
 * under /admin, and every page renders the same chrome (title, nav, status
 * strip, feed health) above its own content.
 */

export async function call(action: string, payload: Record<string, unknown> = {}) {
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res
    .json()
    .catch(() => ({ ok: false, message: `Server returned ${res.status} with an unreadable body.` }));
  return json as { ok: boolean; message?: string };
}

export function useAdminAct() {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function act(action: string, payload: Record<string, unknown> = {}, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setStatus("Working…");
    const res = await call(action, payload);
    setStatus(res.message || (res.ok ? "Done." : "Failed."));
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return { busy, status, setStatus, act };
}

export function Toast({ status, onClear }: { status: string; onClear: () => void }) {
  if (!status) return null;
  return (
    <div className="notice toast" onClick={onClear} title="Dismiss">
      {status}
    </div>
  );
}

export function LoginForm() {
  const router = useRouter();
  const [status, setStatus] = useState("");
  return (
    <div>
      <h1>Admin</h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const password = new FormData(e.currentTarget).get("password") as string;
          const res = await call("login", { password });
          setStatus(res.message || "");
          if (res.ok) router.refresh();
        }}
      >
        <div className="form-row">
          <input className="text" type="password" name="password" placeholder="Admin password" autoFocus />
          <button className="btn primary" type="submit">
            Log in
          </button>
        </div>
      </form>
      <p className="status-line">{status}</p>
    </div>
  );
}

export interface AdminChromeData {
  riverCount: number;
  xMonthly: { used: number; cap: number };
  subscribers: { daily: number; weekly: number };
  updatedAt: string;
  unhealthyFeeds: Array<{ name: string; reason: string }>;
  /** pending reader submissions, badged on the Stories link */
  submissions: number;
  /** undecided source candidates, badged on the Sources link */
  candidates: number;
}

const TOOLS: Array<{ href: string; label: string }> = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/stories", label: "Stories" },
  { href: "/admin/sources", label: "Sources" },
  { href: "/admin/markets", label: "Markets" },
  { href: "/admin/podcasts", label: "Podcasts" },
  { href: "/admin/runs", label: "Runs" },
  { href: "/admin/layout", label: "Layout" },
  { href: "/admin/email", label: "Email" },
  { href: "/admin/announcement", label: "Announcement" },
  { href: "/admin/sponsored", label: "Sponsored" },
  { href: "/admin/leaderboard", label: "Leaderboard" },
  { href: "/admin/farcaster", label: "Farcaster" },
];

export function AdminChrome({ chrome }: { chrome: AdminChromeData }) {
  const pathname = usePathname();
  const { busy, status, setStatus, act } = useAdminAct();

  useEffect(() => {
    // mint/refresh the cosmetic footer-link marker on every authed admin
    // visit, so sessions predating the marker pick it up without re-login
    document.cookie =
      "oa_admin_ui=1; path=/; max-age=31536000; samesite=lax" +
      (location.protocol === "https:" ? "; secure" : "");
  }, []);

  return (
    <>
      <div className="admin-head">
        <h1>Admin</h1>
        <nav className="admin-nav">
          {TOOLS.map((t) => {
            const badge =
              t.href === "/admin/stories" && chrome.submissions > 0
                ? ` (${chrome.submissions})`
                : t.href === "/admin/sources" && chrome.candidates > 0
                  ? ` (${chrome.candidates})`
                  : "";
            const title =
              t.href === "/admin/stories" && chrome.submissions > 0
                ? `${chrome.submissions} pending reader submission(s)`
                : t.href === "/admin/sources" && chrome.candidates > 0
                  ? `${chrome.candidates} source candidate(s) awaiting a decision`
                  : undefined;
            return (
              <Link key={t.href} href={t.href} className={pathname === t.href ? "active" : ""} title={title}>
                {t.label}
                {badge}
              </Link>
            );
          })}
        </nav>
      </div>
      {/* the pipeline button and feed-health notice are global status, so they
          live on the Overview only; every other page keeps just its own tools */}
      <p className="status-line">
        Stream: {chrome.riverCount} items · X this month: {chrome.xMonthly.used}/{chrome.xMonthly.cap} · email subs:{" "}
        {chrome.subscribers.daily} daily / {chrome.subscribers.weekly} weekly · state updated{" "}
        {new Date(chrome.updatedAt).toUTCString().replace("GMT", "UTC")} ·{" "}
        {pathname === "/admin" ? (
          <>
            <button className="btn" disabled={busy} onClick={() => act("runPipeline")}>
              Run pipeline now
            </button>{" "}
          </>
        ) : null}
        <button className="btn" disabled={busy} onClick={() => act("logout")}>
          Log out
        </button>
      </p>
      <Toast status={status} onClear={() => setStatus("")} />
      {pathname === "/admin" && chrome.unhealthyFeeds.length > 0 ? (
        <div className="notice">
          <strong>Feed health:</strong>{" "}
          {chrome.unhealthyFeeds.map((f) => (
            <span key={f.name} className="health-bad">
              {f.name} ({f.reason}){" "}
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}
