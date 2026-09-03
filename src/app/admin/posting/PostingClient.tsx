"use client";

import { useState } from "react";
import { AdminChrome, type AdminChromeData, Toast, useAdminAct } from "../shared";

export interface PostingData {
  x: {
    /** the account's handle from config/site.json, shown in the heading when set */
    handle: string;
    dailyThread: boolean;
    weeklyThread: boolean;
    monthlyThread: boolean;
    maxAutoPerDay: number;
    topN: number;
    storyHourUtc: number;
    maxPerMonth: number;
    usedThisMonth: number;
    overridden: string[];
    configured: boolean;
  };
  farcaster: {
    handle: string;
    dailyDigest: boolean;
    weeklyDigest: boolean;
    monthlyDigest: boolean;
    stories: boolean;
    maxPerDay: number;
    topN: number;
    storyHourUtc: number;
    postedToday: number;
    channel: string;
    overridden: string[];
    configured: boolean;
  };
  reddit: {
    dailyComment: boolean;
    postHourUtc: number;
    subreddit: string;
    overridden: string[];
    configured: boolean;
  };
}

function Toggle({
  label,
  on,
  overridden,
  busy,
  onChange,
  hint,
}: {
  label: string;
  on: boolean;
  overridden: boolean;
  busy: boolean;
  onChange: (next: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="posting-row" title={hint}>
      <span className="posting-label">
        {label}
        {overridden ? <span className="sub"> (set here)</span> : null}
      </span>
      <button type="button" className={`filter-chip${on ? " on" : ""}`} disabled={busy} onClick={() => onChange(true)}>
        on
      </button>
      <button type="button" className={`filter-chip${on ? "" : " on"}`} disabled={busy} onClick={() => onChange(false)}>
        off
      </button>
    </div>
  );
}

export function PostingClient({ chrome, data }: { chrome: AdminChromeData; data: PostingData }) {
  const { busy, status, setStatus, act } = useAdminAct();
  const [storyHour, setStoryHour] = useState(String(data.x.storyHourUtc));
  const [autoPerDay, setAutoPerDay] = useState(String(data.x.maxAutoPerDay));
  const [xTopN, setXTopN] = useState(String(data.x.topN));
  const [fcPerDay, setFcPerDay] = useState(String(data.farcaster.maxPerDay));
  const [fcTopN, setFcTopN] = useState(String(data.farcaster.topN));
  const [fcHour, setFcHour] = useState(String(data.farcaster.storyHourUtc));
  const [redditHour, setRedditHour] = useState(String(data.reddit.postHourUtc));
  const set = (channel: "x" | "farcaster" | "reddit", patch: Record<string, unknown>) => act("setPosting", { channel, ...patch });

  return (
    <div>
      <AdminChrome chrome={chrome} />
      <Toast status={status} onClear={() => setStatus("")} />

      <h2 id="posting">Posting</h2>
      <p className="status-line">
        What each channel posts on its own. Every switch here overrides config/sections.json in site state and takes
        effect on the next pipeline run. A digest that is off is still frozen, emailed, and archived, it just does not
        get posted to that channel.
      </p>

      <h3>X{data.x.handle ? ` · @${data.x.handle.replace(/^@/, "")}` : ""}</h3>
      <div className="admin-card">
        <div className="sub">
          {data.x.usedThisMonth} of {data.x.maxPerMonth} posts used this month
          {data.x.configured ? "" : " · no credentials, every post is a dry run"}
        </div>
        <Toggle label="Daily digest thread" on={data.x.dailyThread} overridden={data.x.overridden.includes("dailyThread")} busy={busy} onChange={(v) => set("x", { dailyThread: v })} hint="Two tweets after the daily freeze: the snapshot lines, then the day page link" />
        <Toggle label="Weekly digest thread" on={data.x.weeklyThread} overridden={data.x.overridden.includes("weeklyThread")} busy={busy} onChange={(v) => set("x", { weeklyThread: v })} hint="Saturday morning, after the weekly freeze" />
        <Toggle label="Monthly digest thread" on={data.x.monthlyThread} overridden={data.x.overridden.includes("monthlyThread")} busy={busy} onChange={(v) => set("x", { monthlyThread: v })} hint="The 1st of the month, after the monthly freeze" />
        <Toggle label="Story posts" on={data.x.maxAutoPerDay > 0} overridden={data.x.overridden.includes("maxAutoPerDay")} busy={busy} onChange={(v) => set("x", { maxAutoPerDay: v ? Math.max(1, Number(autoPerDay) || 1) : 0 })} hint="The day's top story, once the hour below has passed" />
        <div className="posting-row">
          <span className="posting-label">Story posts per day</span>
          <input className="text" value={autoPerDay} onChange={(e) => setAutoPerDay(e.target.value)} style={{ maxWidth: 70 }} />
          <span className="posting-label">from the top</span>
          <input className="text" value={xTopN} onChange={(e) => setXTopN(e.target.value)} style={{ maxWidth: 70 }} title="How deep in the ranked top list a post may draw from" />
          <span className="posting-label">not before (UTC hour)</span>
          <input className="text" value={storyHour} onChange={(e) => setStoryHour(e.target.value)} style={{ maxWidth: 70 }} />
          <button
            className="btn"
            disabled={busy}
            onClick={() => set("x", { maxAutoPerDay: Number(autoPerDay), topN: Number(xTopN), storyHourUtc: Number(storyHour) })}
          >
            Save
          </button>
        </div>
      </div>

      <h3>Farcaster{data.farcaster.handle ? ` · @${data.farcaster.handle.replace(/^@/, "")}` : ""}</h3>
      <div className="admin-card">
        <div className="sub">
          {data.farcaster.postedToday} cast{data.farcaster.postedToday === 1 ? "" : "s"} today
          {data.farcaster.channel ? ` · digests go to /${data.farcaster.channel}` : ""}
          {data.farcaster.configured ? "" : " · no credentials, every cast is a dry run"}
        </div>
        <Toggle label="Daily digest cast" on={data.farcaster.dailyDigest} overridden={data.farcaster.overridden.includes("dailyDigest")} busy={busy} onChange={(v) => set("farcaster", { dailyDigest: v })} />
        <Toggle label="Weekly digest cast" on={data.farcaster.weeklyDigest} overridden={data.farcaster.overridden.includes("weeklyDigest")} busy={busy} onChange={(v) => set("farcaster", { weeklyDigest: v })} />
        <Toggle label="Monthly digest cast" on={data.farcaster.monthlyDigest} overridden={data.farcaster.overridden.includes("monthlyDigest")} busy={busy} onChange={(v) => set("farcaster", { monthlyDigest: v })} />
        <Toggle label="Story casts" on={data.farcaster.stories} overridden={data.farcaster.overridden.includes("stories")} busy={busy} onChange={(v) => set("farcaster", { stories: v })} hint="New top stories as they rank, on the home feed" />
        <div className="posting-row">
          <span className="posting-label">Story casts per day</span>
          <input className="text" value={fcPerDay} onChange={(e) => setFcPerDay(e.target.value)} style={{ maxWidth: 70 }} />
          <span className="posting-label">from the top</span>
          <input className="text" value={fcTopN} onChange={(e) => setFcTopN(e.target.value)} style={{ maxWidth: 70 }} title="How deep in the ranked top list a cast may draw from" />
          <span className="posting-label">not before (UTC hour)</span>
          <input className="text" value={fcHour} onChange={(e) => setFcHour(e.target.value)} style={{ maxWidth: 70 }} />
          <button
            className="btn"
            disabled={busy}
            onClick={() => set("farcaster", { maxPerDay: Number(fcPerDay), topN: Number(fcTopN), storyHourUtc: Number(fcHour) })}
          >
            Save
          </button>
        </div>
      </div>

      <h3>Reddit{data.reddit.subreddit ? ` · r/${data.reddit.subreddit}` : ""}</h3>
      {data.reddit.subreddit ? null : (
        <p className="status-line">No subreddit set: fill in bots.reddit.subreddit in config/sections.json to turn the daily comment on.</p>
      )}
      <div className="admin-card">
        <div className="sub">{data.reddit.configured ? "credentials set" : "no credentials, every post is a dry run"}</div>
        <Toggle label="Daily comment in the daily thread" on={data.reddit.dailyComment} overridden={data.reddit.overridden.includes("dailyComment")} busy={busy} onChange={(v) => set("reddit", { dailyComment: v })} />
        <div className="posting-row">
          <span className="posting-label">not before (UTC hour)</span>
          <input className="text" value={redditHour} onChange={(e) => setRedditHour(e.target.value)} style={{ maxWidth: 70 }} />
          <button className="btn" disabled={busy} onClick={() => set("reddit", { postHourUtc: Number(redditHour) })}>
            Save
          </button>
        </div>
      </div>

      <div className="btn-row">
        <button className="btn" disabled={busy} onClick={() => act("setPosting", { reset: true }, "Clear every override here and go back to what config/sections.json says?")}>
          Reset all to config
        </button>
      </div>
    </div>
  );
}
