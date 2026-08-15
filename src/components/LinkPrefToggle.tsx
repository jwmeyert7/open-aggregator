"use client";

import { useEffect, useState } from "react";

/**
 * "Open links in new tab" preference. Applies only to OUTBOUND links (story
 * sources, sponsors); internal navigation always stays in-tab. Defaults on
 * for mouse devices, off for touch, until the user chooses.
 */
export function LinkPrefToggle() {
  const [on, setOn] = useState<boolean | null>(null);

  useEffect(() => {
    let initial: boolean;
    try {
      const saved = localStorage.getItem("newtab");
      initial = saved !== null ? saved === "1" : !window.matchMedia("(pointer: coarse)").matches;
    } catch {
      initial = true;
    }
    setOn(initial);
  }, []);

  useEffect(() => {
    if (!on) return;
    function onClick(e: MouseEvent) {
      const anchor = (e.target as HTMLElement | null)?.closest?.("a");
      if (!anchor?.href) return;
      try {
        if (new URL(anchor.href).origin !== window.location.origin) {
          anchor.target = "_blank";
          anchor.rel = anchor.rel ? `${anchor.rel} noopener` : "noopener";
        }
      } catch {}
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [on]);

  if (on === null) return null;

  return (
    <label className="footer-pref">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          setOn(e.target.checked);
          try {
            localStorage.setItem("newtab", e.target.checked ? "1" : "0");
          } catch {}
        }}
      />{" "}
      open links in new tab
    </label>
  );
}
