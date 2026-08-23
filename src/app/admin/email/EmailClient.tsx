"use client";

import { timeAgo } from "@/lib/util";
import { AdminChrome, type AdminChromeData, Toast, useAdminAct } from "../shared";

export interface EmailData {
  subscribers: { daily: number; weekly: number };
  emailSubscribers: Array<{ email: string; daily: boolean; weekly: boolean; confirmed: boolean; addedAt: string }>;
}

export function EmailClient({ chrome, data }: { chrome: AdminChromeData; data: EmailData }) {
  const { busy, status, setStatus, act } = useAdminAct();

  return (
    <div>
      <AdminChrome chrome={chrome} />
      <Toast status={status} onClear={() => setStatus("")} />

      <h2 id="email">Email digests</h2>
      <p className="status-line">
        {data.emailSubscribers.length} subscriber{data.emailSubscribers.length === 1 ? "" : "s"} ·{" "}
        {data.subscribers.daily} daily / {data.subscribers.weekly} weekly. New signups receive nothing until they click
        their confirmation link.
      </p>
      <div className="btn-row" style={{ marginBottom: 10 }}>
        <button className="btn" disabled={busy} onClick={() => act("testDigestEmail", { kind: "daily" })}>
          Email me the latest daily
        </button>
        <button className="btn" disabled={busy} onClick={() => act("testDigestEmail", { kind: "weekly" })}>
          Email me the weekly
        </button>
      </div>
      {data.emailSubscribers.map((s) => (
        <div key={s.email} className="admin-card">
          <div className="sub">
            <strong>{s.email}</strong> · {[s.daily ? "daily" : null, s.weekly ? "weekly" : null].filter(Boolean).join(" + ")} ·{" "}
            {s.confirmed ? "confirmed" : <span className="health-bad">unconfirmed</span>} · joined {timeAgo(s.addedAt)}{" "}
            <button
              className="btn"
              disabled={busy}
              onClick={() => act("testDigestEmail", { kind: "daily", email: s.email }, `Send the latest daily edition to ${s.email}?`)}
            >
              Send daily
            </button>{" "}
            <button
              className="btn"
              disabled={busy}
              onClick={() => act("testDigestEmail", { kind: "weekly", email: s.email }, `Send the weekly edition to ${s.email}?`)}
            >
              Send weekly
            </button>{" "}
            {!s.confirmed ? (
              <button className="btn" disabled={busy} onClick={() => act("resendConfirmation", { email: s.email })}>
                Resend confirmation
              </button>
            ) : null}{" "}
            <button
              className="btn danger"
              disabled={busy}
              onClick={() => act("removeSubscriber", { email: s.email }, `Remove ${s.email} from the list?`)}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
