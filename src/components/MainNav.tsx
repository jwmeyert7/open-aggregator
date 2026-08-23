"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function MainNav({ sections }: { sections: Array<{ id: string; title: string }> }) {
  const path = usePathname();
  // The tabs belong to the front page and the section pages only. Those
  // pages carry their own in-grid header row on desktop, so this nav is
  // purely their mobile furniture; everywhere else it renders nothing.
  // /new is mobile's fifth tab, so the row stays visible there too
  // /podcasts is mobile's sixth: the Podcasts box stacks below the whole story
  // list on small screens, so the menu is its one-tap reach there
  const gridPage =
    path === "/" || path === "/new" || path === "/podcasts" || sections.some((s) => `/${s.id}` === path);
  if (!gridPage) return null;
  return (
    <nav className="main-nav wrap mobile-only">
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
      <Link href="/podcasts" className={`nav-new${path === "/podcasts" ? " active" : ""}`}>
        Podcasts
      </Link>
    </nav>
  );
}
