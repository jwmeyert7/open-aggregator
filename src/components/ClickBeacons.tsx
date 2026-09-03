"use client";

import { useEffect } from "react";

/**
 * Counts outbound story clicks without touching navigation: one delegated
 * capture-phase listener, a sendBeacon (which survives the page unloading),
 * and never a preventDefault. Admin visits are skipped the same way
 * SiteAnalytics skips them. If the project ever moves to a Vercel plan with
 * Web Analytics Plus, a track("outbound_click") could ride along here.
 */
export function ClickBeacons() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const a = target?.closest?.("a[data-oa-story],a[data-oa-sp]") as HTMLAnchorElement | null;
      if (!a || document.cookie.includes("oa_admin_ui=1")) return;
      const sponsored = a.hasAttribute("data-oa-sp");
      const payload = JSON.stringify({
        k: sponsored ? "sp" : "story",
        ...(a.dataset.oaStory ? { id: a.dataset.oaStory } : {}),
        u: a.href,
      });
      try {
        navigator.sendBeacon?.("/api/beacon", payload);
      } catch {}
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("auxclick", onClick, true);
    };
  }, []);
  return null;
}
