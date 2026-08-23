"use client";

import { AdminChrome, type AdminChromeData, Toast, useAdminAct } from "../shared";

export interface LayoutData {
  preview: "weekday" | "weekend" | null;
  scheduled: "weekday" | "weekend";
  schedule: { startDow: number; startHour: number; endDow: number; endHour: number };
  custom: boolean;
}

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function LayoutClient({ chrome, data }: { chrome: AdminChromeData; data: LayoutData }) {
  const { busy, status, setStatus, act } = useAdminAct();

  return (
    <div>
      <AdminChrome chrome={chrome} />
      <Toast status={status} onClear={() => setStatus("")} />

      <h2 id="layout">Layout</h2>
      <p className="status-line">
        Visitors see the <strong>{data.scheduled}</strong> layout right now.
        {data.preview
          ? ` You are previewing the ${data.preview} layout (this browser only).`
          : " No preview active: you see what visitors see."}
      </p>
      <div className="btn-row" style={{ marginBottom: 10 }}>
        <button className="btn" disabled={busy} onClick={() => act("setLayoutPreview", { mode: "weekday" })}>
          Preview weekday
        </button>
        <button className="btn" disabled={busy} onClick={() => act("setLayoutPreview", { mode: "weekend" })}>
          Preview weekend
        </button>
        <button
          className="btn"
          disabled={busy || !data.preview}
          onClick={() => act("setLayoutPreview", { mode: "clear" })}
        >
          Clear preview
        </button>
        <a href="/" target="_blank" rel="noopener">
          Open front page ↗
        </a>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          act("setWeekendSchedule", {
            startDow: f.get("startDow"),
            startHour: f.get("startHour"),
            endDow: f.get("endDow"),
            endHour: f.get("endHour"),
          });
        }}
      >
        <div className="form-row">
          <span className="sub">Weekend look runs from</span>
          <select className="select" name="startDow" defaultValue={String(data.schedule.startDow)}>
            {DOW.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
          <select className="select" name="startHour" defaultValue={String(data.schedule.startHour)}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
          <span className="sub">until</span>
          <select className="select" name="endDow" defaultValue={String(data.schedule.endDow)}>
            {DOW.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
          <select className="select" name="endHour" defaultValue={String(data.schedule.endHour)}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
          <span className="sub">UTC</span>
          <button className="btn primary" type="submit" disabled={busy}>
            Save window
          </button>
          {data.custom ? (
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => act("setWeekendSchedule", { reset: true }, "Reset the weekend window to the built-in default?")}
            >
              Reset to default
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
