"use client";

import { AdminChrome, type AdminChromeData, Toast, useAdminAct } from "../shared";

export interface AnnouncementData {
  announcement: { text: string; url?: string; hidden?: boolean } | null;
}

export function AnnouncementClient({ chrome, data }: { chrome: AdminChromeData; data: AnnouncementData }) {
  const { busy, status, setStatus, act } = useAdminAct();

  return (
    <div>
      <AdminChrome chrome={chrome} />
      <Toast status={status} onClear={() => setStatus("")} />

      <h2 id="announcement">Announcement slot</h2>
      <p className="status-line">
        {data.announcement?.text
          ? `${data.announcement.hidden ? "Saved but hidden" : "Currently live"}: “${data.announcement.text}”`
          : "Empty. Nothing renders on the site."}
        {data.announcement?.text ? (
          <>
            {" "}
            <label className="shown-check">
              <input
                type="checkbox"
                checked={!data.announcement.hidden}
                disabled={busy}
                onChange={() => act("toggleAnnouncement")}
              />{" "}
              shown
            </label>
          </>
        ) : null}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          act("setAnnouncement", { text: f.get("text"), url: f.get("url") });
        }}
      >
        <div className="form-row">
          <input className="text" name="text" placeholder="Announcement text" defaultValue={data.announcement?.text ?? ""} />
          <input className="text" name="url" placeholder="Link URL (optional)" defaultValue={data.announcement?.url ?? ""} />
          <button className="btn primary" type="submit" disabled={busy}>
            Save
          </button>
          <button
            className="btn danger"
            type="button"
            disabled={busy || !data.announcement}
            onClick={() => act("setAnnouncement", { text: "" }, "Clear the announcement and restore the placeholder?")}
          >
            Clear
          </button>
        </div>
      </form>
    </div>
  );
}
