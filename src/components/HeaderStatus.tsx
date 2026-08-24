"use client";

import { useEffect, useRef, useState } from "react";

export function HeaderStatus() {
  const [now, setNow] = useState<Date | null>(null);
  const [use24h, setUse24h] = useState(false);
  const [useUtc, setUseUtc] = useState(false);
  // time-travel picker: the date opens a small form that resolves to the
  // archived front-page snapshot nearest the chosen moment
  const [pick, setPick] = useState(false);
  const [pickValue, setPickValue] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // clicking anywhere outside the strip dismisses the picker
  useEffect(() => {
    if (!pick) return;
    function onDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setPick(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [pick]);

  useEffect(() => {
    try {
      setUse24h(localStorage.getItem("clock24") === "1");
      setUseUtc(localStorage.getItem("clockUtc") === "1");
    } catch {}
    setNow(new Date());
    // minute-resolution clock: re-render only when the displayed minute changes
    const clock = setInterval(() => {
      setNow((prev) => {
        const next = new Date();
        return prev && prev.getMinutes() === next.getMinutes() ? prev : next;
      });
    }, 1000);
    return () => clearInterval(clock);
  }, []);

  // the strip is selectable text, and mouseup after a drag-selection still
  // fires click, so a click that follows a selection must not act
  function unlessSelecting(fn: () => void) {
    return () => {
      if (window.getSelection()?.toString()) return;
      fn();
    };
  }

  function toggleUtc() {
    setUseUtc((v) => {
      try {
        localStorage.setItem("clockUtc", v ? "0" : "1");
      } catch {}
      return !v;
    });
  }

  function set24h(on: boolean) {
    setUse24h(on);
    try {
      localStorage.setItem("clock24", on ? "1" : "0");
    } catch {}
  }

  function openPick() {
    if (pick) {
      setPick(false);
      return;
    }
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    setPickValue(
      `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
    );
    setPick(true);
  }

  function goPick(e: React.FormEvent) {
    e.preventDefault();
    const d = new Date(pickValue);
    if (!Number.isNaN(d.getTime())) window.location.href = `/goto?t=${encodeURIComponent(d.toISOString())}`;
  }

  if (!now) return <div className="header-status" />;

  const h24 = useUtc ? now.getUTCHours() : now.getHours();
  const mm = String(useUtc ? now.getUTCMinutes() : now.getMinutes()).padStart(2, "0");
  const time = use24h ? `${String(h24).padStart(2, "0")}:${mm}` : `${h24 % 12 || 12}:${mm}`;
  const suffix = h24 < 12 ? "AM" : "PM";
  const tz = useUtc ? { timeZone: "UTC" as const } : {};
  const dateFull = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", ...tz });
  // phones swap in the short form (CSS toggles the spans): the full date
  // doesn't fit beside the wordmark and the search box
  const dateShort = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...tz });

  return (
    <div className="header-status" ref={rootRef}>
      <span className="status-row">
        <button
          className="clock-part status-date"
          onClick={unlessSelecting(openPick)}
          title="See the front page as it was on a past date"
        >
          <span className="date-full">{dateFull}</span>
          <span className="date-short">{dateShort}</span>
        </button>
        <span className="clock">
          <button className="clock-part" onClick={unlessSelecting(toggleUtc)} title="Toggle local / UTC">
            {time}
          </button>
          {use24h ? (
            <button className="clock-part clock-blank" onClick={unlessSelecting(() => set24h(false))} title="Switch to 12-hour">
              24h
            </button>
          ) : (
            <button className="clock-part" onClick={unlessSelecting(() => set24h(true))} title="Switch to 24-hour">
              {suffix}
            </button>
          )}
          {useUtc ? (
            <button className="clock-part" onClick={unlessSelecting(toggleUtc)} title="Toggle local / UTC">
              UTC
            </button>
          ) : null}
        </span>
      </span>
      {pick ? (
        <form className="header-pick" onSubmit={goPick}>
          <input
            className="text"
            type="datetime-local"
            value={pickValue}
            onChange={(e) => setPickValue(e.target.value)}
            autoFocus
          />
          <button className="btn primary" type="submit">
            Go
          </button>
          {/* dismissal is click-away (see the pointerdown effect above) */}
        </form>
      ) : null}
    </div>
  );
}
