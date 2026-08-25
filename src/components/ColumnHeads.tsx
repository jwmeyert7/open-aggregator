import Link from "next/link";

/**
 * Desktop tabs row inside the front/section page grid, sitting over the story
 * column. On mobile this cell hides and the sticky MainNav takes over. The
 * rails label themselves, so this is only the tabs.
 */
export function ColumnHeads({
  sections,
  active,
  tagline,
  taglineNote,
}: {
  sections: Array<{ id: string; title: string; tooltip?: string }>;
  active: string;
  /** the active section's one-liner, rendered inside the nav so it rides the tab row's grid placement */
  tagline?: string;
  /** transient linked addendum after the tagline (config taglineNote), section pages only */
  taglineNote?: { text: string; linkText: string; href: string };
}) {
  return (
    <nav className="main-nav in-grid">
      <Link href="/" className={active === "top" ? "active" : ""}>
        Top Stories
      </Link>
      {sections.map((s) => (
        <Link key={s.id} href={`/${s.id}`} className={active === s.id ? "active" : ""} title={s.tooltip}>
          {s.title}
        </Link>
      ))}
      {tagline ? (
        <span className="section-tagline">
          {tagline}
          {taglineNote ? (
            <>
              {" "}
              {taglineNote.text}
              <a href={taglineNote.href} rel="noopener">
                {taglineNote.linkText}
              </a>
            </>
          ) : null}
        </span>
      ) : null}
    </nav>
  );
}
