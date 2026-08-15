"use client";

import { useEffect, useRef, useState } from "react";

/** Hold the sun or moon this long to cross into space mode. */
const HOLD_MS = 1100;

export function ThemeToggle() {
  const [theme, setTheme] = useState<string>("");
  const [announce, setAnnounce] = useState("");
  // a completed hold must not also fire the click that follows it
  const hold = useRef<{ timer: number | null; fired: boolean }>({ timer: null, fired: false });

  useEffect(() => {
    // On the 404 error shell the head script never executes; repair here.
    if (!document.documentElement.dataset.theme) {
      let t: string | null = null;
      try {
        t = localStorage.getItem("theme");
      } catch {}
      if (t !== "light" && t !== "dark") {
        t = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      }
      document.documentElement.dataset.theme = t;
    }
    setTheme(document.documentElement.dataset.theme || "light");

    // users with no explicit choice follow the OS setting live
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function onOsChange() {
      try {
        if (localStorage.getItem("theme")) return; // explicit choice wins
      } catch {}
      const next = mq.matches ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      setTheme(next);
    }
    mq.addEventListener("change", onOsChange);
    return () => mq.removeEventListener("change", onOsChange);
  }, []);

  function toggle() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {}
    setTheme(next);
  }

  function toggleSpace() {
    const root = document.documentElement;
    const on = root.dataset.space === "on";
    if (on) delete root.dataset.space;
    else root.dataset.space = "on";
    try {
      localStorage.setItem("space", on ? "0" : "1");
    } catch {}
    setAnnounce(on ? "Space mode off" : "Space mode on");
    if (navigator.vibrate) navigator.vibrate(on ? 10 : [12, 40, 12]);
  }

  function startHold() {
    hold.current.fired = false;
    hold.current.timer = window.setTimeout(() => {
      hold.current.fired = true;
      toggleSpace();
    }, HOLD_MS);
  }

  function endHold() {
    if (hold.current.timer !== null) {
      clearTimeout(hold.current.timer);
      hold.current.timer = null;
    }
  }

  return (
    <>
      <button
        className="theme-toggle"
        onClick={() => {
          if (hold.current.fired) {
            hold.current.fired = false;
            return;
          }
          toggle();
        }}
        onPointerDown={startHold}
        onPointerUp={endHold}
        onPointerLeave={endHold}
        onPointerCancel={endHold}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Toggle color theme"
        title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      >
        {theme === "dark" ? "☀" : "☾"}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {announce}
      </span>
    </>
  );
}
