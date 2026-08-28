import { parseSummaryLines, type SummarySection } from "@/lib/util";

/**
 * Editor-model summary box. Lines carry "[<sectionId>]" markers
 * (parseSummaryLines) and render as one fixed box per configured section,
 * side by side on desktop. Every section box ALWAYS renders so the page
 * keeps its shape: a section the editor gave no bullet says so plainly
 * instead of disappearing. Lines with no marker render as one flat list.
 */
export function SummaryBlock({
  text,
  sections,
  heading = "Latest in",
  aboveNav = false,
  quietText = "Nothing notable right now.",
  storyHrefs,
  fallbackHref,
  footer,
}: {
  text: string;
  /** The configured nav sections, in display order. */
  sections: Array<{ id: string; title: string }>;
  /** Box label, e.g. "Week in review" on weekend front pages. */
  heading?: string;
  /** Front-page placement in the grid row above the section tabs. */
  aboveNav?: boolean;
  /** Last-resort line for a section box with no bullet; tense varies by page. */
  quietText?: string;
  /**
   * Where each cluster id can be reached from this page: "#s-<id>" for a story
   * card rendered below (in-page jump), or its "/story/<slug>" permalink when
   * the story isn't on the page. A bullet whose ref has no entry stays plain
   * text, so a link never points nowhere.
   */
  storyHrefs?: ReadonlyMap<string, string>;
  /**
   * Front page only: destination for a bullet with no usable story ref (the
   * page fuzzy-matches the line to the story it is plainly about). Off on
   * frozen pages (snapshots, day reviews), where the live site no longer
   * matches the frozen text.
   */
  fallbackHref?: (section: SummarySection, text: string) => string | undefined;
  /** Extra content at the bottom of the box (the mobile top-podcast row). */
  footer?: React.ReactNode;
}) {
  const lines = parseSummaryLines(text);
  if (lines.length === 0) return null;
  const knownIds = new Set(sections.map((s) => s.id));
  const untagged = lines.filter((l) => l.section === null || !knownIds.has(l.section));
  const tagged = lines.filter((l) => l.section !== null && knownIds.has(l.section));
  const bullet = (l: {
    section: SummarySection | null;
    ref: string | null;
    text: string;
    segments: Array<{ text: string; ref: string | null }>;
  }) => {
    const lineHref =
      (l.ref ? storyHrefs?.get(l.ref) : undefined) ??
      (l.section && fallbackHref ? fallbackHref(l.section, l.text) : undefined);
    // a line naming several stories carries phrase-level refs: each linked
    // phrase goes to ITS story, the rest of the line to the line's own
    if (l.segments.some((s) => s.ref && storyHrefs?.get(s.ref))) {
      return l.segments.map((s, i) => {
        const href = (s.ref ? storyHrefs?.get(s.ref) : undefined) ?? lineHref;
        return href ? (
          <a key={i} href={href} className="summary-jump">
            {s.text}
          </a>
        ) : (
          <span key={i}>{s.text}</span>
        );
      });
    }
    return lineHref ? (
      <a href={lineHref} className="summary-jump">
        {l.text}
      </a>
    ) : (
      l.text
    );
  };
  return (
    <>
      {!aboveNav ? <div className="front-summary-label">{heading}</div> : null}
      <div className={`front-summary${aboveNav ? " above-nav" : ""}`}>
      <div className="front-summary-head">{heading}</div>
      {untagged.length > 0 ? (
        <ul>
          {untagged.map((l) => (
            <li key={l.text}>{bullet(l)}</li>
          ))}
        </ul>
      ) : null}
      {tagged.length > 0 ? (
        <div className="front-summary-groups" style={{ ["--summary-cols" as string]: sections.length }}>
          {sections.map((s) => {
            const group = tagged.filter((l) => l.section === s.id);
            return (
              <div className="front-summary-group" key={s.id}>
                <a className="front-summary-sec" href={`/${s.id}`}>{s.title}</a>
                {group.length > 0 ? (
                  <ul>
                    {group.map((l) => (
                      <li key={l.text}>{bullet(l)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="front-summary-quiet">{quietText}</p>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
      {footer}
      </div>
    </>
  );
}
