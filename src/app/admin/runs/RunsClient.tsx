"use client";

import { useState } from "react";
import type { RunLogEntry } from "@/lib/types";
import { AdminChrome, type AdminChromeData, Toast, useAdminAct } from "../shared";

export interface RunsData {
  runs: RunLogEntry[];
  digests: Array<{ date: string; stories: number; cast: boolean; tweetId: string | null }>;
}

export function RunsClient({ chrome, data }: { chrome: AdminChromeData; data: RunsData }) {
  const { busy, status, setStatus, act } = useAdminAct();
  const [showAllRuns, setShowAllRuns] = useState(false);

  return (
    <div>
      <AdminChrome chrome={chrome} />
      <Toast status={status} onClear={() => setStatus("")} />

      <h2 id="runs">Pipeline runs</h2>
      <div className="btn-row" style={{ marginBottom: 10 }}>
        <button className="btn primary" disabled={busy} onClick={() => act("runPipeline")}>
          Run pipeline now
        </button>
        <button className="btn" disabled={busy} onClick={() => act("refreshSummary")}>
          Refresh summary
        </button>
      </div>
      {data.digests.length > 0 ? (
        <div className="admin-card">
          <div className="headline">Daily digests</div>
          {data.digests.map((d) => (
            <div key={d.date} className="sub" style={{ margin: "4px 0" }}>
              <a href={`/day/${d.date}`}>{d.date}</a> · {d.stories} stories · cast {d.cast ? "posted" : "missing"} · X{" "}
              {d.tweetId ? (
                <a href={`https://x.com/i/web/status/${d.tweetId}`} rel="noopener">
                  posted
                </a>
              ) : (
                <>
                  missing{" "}
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => act("tweetDigest", { date: d.date }, `Tweet the ${d.date} digest to X now?`)}
                  >
                    Tweet now
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      ) : null}
      {data.runs.length === 0 ? <p className="empty-state">No runs recorded yet.</p> : null}
      {(showAllRuns ? data.runs : data.runs.slice(0, 5)).map((r) => (
        <div key={r.at} className="admin-card">
          <div className="headline">
            {new Date(r.at).toUTCString().replace("GMT", "UTC")} <span className="sub">· {(r.ms / 1000).toFixed(1)}s</span>
          </div>
          <div className="sub">
            {r.newItems} new item{r.newItems === 1 ? "" : "s"} · {r.rejected} rejected by gate · {r.clustersCreated} new
            {" / "}
            {r.clustersUpdated} updated stories · LLM {r.usedLlm ? "used" : "not used"}
            {r.snapshot ? ` · snapshot ${r.snapshot}` : ""}
            {r.posted.length > 0 ? ` · posted: ${r.posted.join(", ")}` : ""}
          </div>
          {r.feedErrors.length > 0 ? (
            <div className="sub health-bad">
              feed errors: {r.feedErrors.map((e) => `${e.feedId} (${e.error.split("\n")[0]})`).join(", ")}
            </div>
          ) : null}
          {r.notes.length > 0 ? <div className="sub">{r.notes.join(" · ")}</div> : null}
          {r.rejectedSamples && r.rejectedSamples.length > 0 ? (
            <details className="links-detail">
              <summary>rejected samples ({r.rejectedSamples.length})</summary>
              {r.rejectedSamples.map((s, i) => (
                <div key={i} className="sub" style={{ margin: "4px 0" }}>
                  <strong>{s.source}</strong>: {s.title}
                  <br />↳ {s.reason}
                </div>
              ))}
            </details>
          ) : null}
        </div>
      ))}
      {!showAllRuns && data.runs.length > 5 ? (
        <button className="btn" onClick={() => setShowAllRuns(true)}>
          Show all {data.runs.length} runs
        </button>
      ) : null}
    </div>
  );
}
