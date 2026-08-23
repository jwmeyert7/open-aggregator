"use client";

import { timeAgo } from "@/lib/util";
import { AdminChrome, type AdminChromeData, Toast, useAdminAct } from "../shared";

export interface MarketsData {
  sections: string[];
  markets: Array<{
    slug: string;
    label: string;
    section: string;
    custom: boolean;
    disabled: boolean;
    prob: number | null;
    url: string;
    resolved: boolean;
    lastSwingAt: string | null;
  }>;
  marketCfg: { threshold: number; cooldownHours: number; minLiquidity: number } | null;
}

export function MarketsClient({ chrome, data }: { chrome: AdminChromeData; data: MarketsData }) {
  const { busy, status, setStatus, act } = useAdminAct();

  return (
    <div>
      <AdminChrome chrome={chrome} />
      <Toast status={status} onClear={() => setStatus("")} />

      <h2 id="markets">Markets</h2>
      <p className="status-line">
        Polymarket event markets watched for exceptional swings
        {data.marketCfg
          ? ` (house story at a ±${data.marketCfg.threshold}-point move in 24h on ≥$${data.marketCfg.minLiquidity.toLocaleString()} liquidity, ${data.marketCfg.cooldownHours}h cooldown per market)`
          : ""}
        . Built-in markets come from config/sections.json and can be disabled here; markets you add live in site state
        and can be removed. Event markets only, never pure price markets. Changes take effect on the next pipeline run;
        a slug that fails to resolve shows up in the run notes.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          act("addMarket", { slug: f.get("slug"), label: f.get("label"), section: f.get("section") });
          e.currentTarget.reset();
        }}
      >
        <div className="form-row">
          <input className="text" name="slug" placeholder="Market URL or slug" required />
          <input
            className="text"
            name="label"
            placeholder="Headline subject, e.g. “the treaty being ratified in 2026”"
            required
          />
          <select className="select" name="section" style={{ width: "auto" }}>
            <option value="">section…</option>
            {data.sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button className="btn" type="submit" disabled={busy}>
            Add market
          </button>
        </div>
      </form>
      {data.markets.length === 0 ? (
        <p className="status-line">No markets configured.</p>
      ) : (
        data.markets.map((m) => (
          <div key={m.slug} className="admin-card">
            <div className="headline">
              {m.disabled ? "⏸ " : ""}
              {m.label} {m.custom ? <span className="sub">(added by admin)</span> : null}
            </div>
            <div className="sub">
              {m.prob !== null ? (
                <span className="health-ok">~{m.prob}% implied</span>
              ) : (
                <span>not yet polled</span>
              )}{" "}
              ·{" "}
              <a href={m.url} rel="noopener" title={m.resolved ? "The market's event page on Polymarket" : "Best-guess link: the market hasn't resolved via the API yet, so this may not land anywhere"}>
                {m.slug}
              </a>
              {m.resolved ? "" : " (unresolved)"} · {m.section}
              {m.lastSwingAt ? ` · last swing story ${timeAgo(m.lastSwingAt)}` : ""}
            </div>
            <div className="btn-row">
              <button className="btn" type="button" disabled={busy} onClick={() => act("toggleMarket", { slug: m.slug })}>
                {m.disabled ? "Enable" : "Disable"}
              </button>
              {m.custom ? (
                <button
                  className="btn danger"
                  type="button"
                  disabled={busy}
                  onClick={() => act("removeMarket", { slug: m.slug }, `Remove market “${m.label}”?`)}
                >
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
