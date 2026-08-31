"use client";

import { useState } from "react";

/**
 * One switch for every chapter list on the page. It speaks over a window
 * event so the server-rendered episode list needs no re-plumbing: players
 * that have chapters obey, everything else ignores it.
 */
export function ChaptersAllToggle() {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      className="linklike chapters-all"
      onClick={() => {
        const next = !open;
        setOpen(next);
        window.dispatchEvent(new CustomEvent("podcast:chapters-all", { detail: { open: next } }));
      }}
    >
      {open ? "hide all chapters ▴" : "show all chapters ▾"}
    </button>
  );
}
