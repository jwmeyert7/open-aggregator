"use client";

import Link from "next/link";

/** Plain text wordmark: the configured site name, linking home. */
export function Wordmark({ siteName }: { siteName: string }) {
  return (
    <Link
      href="/"
      className="logo"
      // already home: same-route navigation is a no-op, so glide back to the top
      onClick={() => {
        if (window.location.pathname === "/") window.scrollTo({ top: 0, behavior: "smooth" });
      }}
    >
      {siteName}
    </Link>
  );
}
