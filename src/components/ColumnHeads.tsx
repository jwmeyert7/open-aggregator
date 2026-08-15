import Link from "next/link";

/**
 * Desktop tabs row inside the front/section page grid, sitting over the story
 * column. On mobile this cell hides and the sticky MainNav takes over. The
 * rails label themselves, so this is only the tabs.
 */
export function ColumnHeads({
  sections,
  active,
}: {
  sections: Array<{ id: string; title: string }>;
  active: string;
}) {
  return (
    <nav className="main-nav in-grid">
      <Link href="/" className={active === "top" ? "active" : ""}>
        Top Stories
      </Link>
      {sections.map((s) => (
        <Link key={s.id} href={`/${s.id}`} className={active === s.id ? "active" : ""}>
          {s.title}
        </Link>
      ))}
    </nav>
  );
}
