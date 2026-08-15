"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function MainNav({ sections }: { sections: Array<{ id: string; title: string }> }) {
  const path = usePathname();
  if (
    path.startsWith("/admin") ||
    path.startsWith("/day") ||
    ["/archive", "/stream", "/privacy", "/contact", "/submit", "/criteria", "/sponsor", "/sources", "/subscribe"].includes(path)
  )
    return null;
  // front/section pages carry their own in-grid header row on desktop
  const gridPage = path === "/" || sections.some((s) => `/${s.id}` === path);
  return (
    <nav className={`main-nav wrap${gridPage ? " mobile-only" : ""}`}>
      <Link href="/" className={path === "/" ? "active" : ""}>
        Top Stories
      </Link>
      {sections.map((s) => (
        <Link key={s.id} href={`/${s.id}`} className={path === `/${s.id}` ? "active" : ""}>
          {s.title}
        </Link>
      ))}
      {/* only shown at widths where the Newest column has dropped below the stories */}
      <Link href="/new" className={`nav-new${path === "/new" ? " active" : ""}`}>
        New
      </Link>
    </nav>
  );
}
