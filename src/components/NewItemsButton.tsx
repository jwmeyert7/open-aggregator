"use client";

import { useEffect, useState } from "react";

/** Techmeme-style refresh pill: appears when items landed after this page rendered. */
export function NewItemsButton({ latestId }: { latestId?: string }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!latestId) return;
    let alive = true;
    async function poll() {
      try {
        const res = await fetch(`/api/updates?since=${encodeURIComponent(latestId!)}`);
        const json = await res.json();
        if (alive && typeof json.newCount === "number") setCount(json.newCount);
      } catch {}
    }
    const t = setInterval(poll, 45000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [latestId]);

  if (count <= 0) return null;
  return (
    <button className="new-items" onClick={() => window.location.reload()}>
      {count > 99 ? "99+" : count} new item{count === 1 ? "" : "s"}
    </button>
  );
}
