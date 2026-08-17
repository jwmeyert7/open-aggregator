import Link from "next/link";
import { adminLayoutPreview } from "@/lib/auth";
import { ClusterCard, SponsoredCard } from "@/components/ClusterCard";
import { ColumnHeads } from "@/components/ColumnHeads";
import { hasSidebarContent, NewestRail, Sidebar, sidebarSponsored } from "@/components/Sidebar";
import { SummaryBlock } from "@/components/SummaryBlock";
import { loadSiteConfig } from "@/lib/config";
import { maybeDevSeed } from "@/lib/devSeed";
import { adaptiveRanking, byPublished, itemDisplayTitle, leadLink, liveClusters, topStories, weekendMode, weekInReview } from "@/lib/rank";
import { loadState } from "@/lib/state";
import { FRONT_SUMMARY_MAX_AGE_HOURS, sponsoredPlacements } from "@/lib/types";
import { bestMatchIndex, echoesHeadline, hoursAgo, parseSummaryLines } from "@/lib/util";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const state = await loadState();
  const cfg = loadSiteConfig();
  maybeDevSeed(state);
  // quiet spells stretch decay so real stories stay legible instead of fading
  // against competition that never arrived
  const ranking = adaptiveRanking(state, cfg.ranking);
  const stories = topStories(state, ranking);
  /**
   * Weekends run about an eighth of the weekday inflow, so the week's biggest
   * stories lead the page rather than whatever happened to arrive overnight.
   * The week block is ranked over EVERY story of the week, including the ones
   * currently topping the page: excluding those left it listing leftovers
   * (routine client releases) while the week's actual lead sat above it. The
   * list below then drops what the block already covered, so nothing repeats.
   */
  // admins can force either layout in their own browser to inspect and tweak
  // it; the schedule (default or admin-edited) decides for everyone else
  const preview = await adminLayoutPreview();
  const scheduledWeekend = weekendMode(cfg.ranking, new Date(), state.weekendSchedule);
  const weekend = preview ? preview === "weekend" : scheduledWeekend;
  const week = weekend ? weekInReview(state, ranking, new Set()) : [];
  const leadWithWeek = week.length >= 3;
  const weekIds = new Set(week.map((c) => c.id));
  const latest = leadWithWeek ? stories.filter((c) => !weekIds.has(c.id)) : stories;
  const summary =
    state.frontSummary?.text && hoursAgo(state.frontSummary.at) <= FRONT_SUMMARY_MAX_AGE_HOURS
      ? state.frontSummary.text
      : "";
  // a bullet that just restates a headline sitting inches below it reads as a
  // bug, so drop those rather than trusting the prompt rule alone; compare the
  // bullet's text without its "[section]" marker, keep the marked line. But a
  // section box may never end up empty: an imperfect bullet beats a "nothing
  // notable" placeholder, so an echoing line survives when it is all its
  // section has.
  const shownHeadlines = [...week, ...latest].map((c) => c.headline);
  const parsedGist = summary
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((raw) => {
      const p = parseSummaryLines(raw)[0];
      return { raw, section: p?.section ?? null, echoes: echoesHeadline(p?.text ?? raw, shownHeadlines) };
    });
  const gistLines = parsedGist
    .filter(
      (l, _, all) =>
        !l.echoes ||
        (l.section !== null && !all.some((o) => o !== l && o.section === l.section && !o.echoes))
    )
    .map((l) => l.raw);

  // each live story's reachable address from this page: an in-page jump when
  // its card renders below, its permalink otherwise
  const shownIds = new Set([...week, ...latest].map((c) => c.id));
  const storyHref = new Map(
    liveClusters(state).map((c) => [c.id, shownIds.has(c.id) ? `#s-${c.id}` : `/story/${c.slug}`])
  );

  const showSidebar = hasSidebarContent(state);
  const summaryAt = (aboveNav: boolean) =>
    gistLines.length > 0 ? (
      <SummaryBlock
        aboveNav={aboveNav}
        sections={cfg.sections.map((s) => ({ id: s.id, title: s.title }))}
        heading={leadWithWeek ? "Week in review" : "Latest in"}
        quietText={leadWithWeek ? "A quiet week here." : undefined}
        text={gistLines.join("\n")}
        // a bullet's story jumps in page when its card is below, and falls
        // back to the story permalink when it ranks off the front page
        storyHrefs={storyHref}
        // a refless bullet fuzzy-matches to the story it is plainly about;
        // its section page is the last resort when nothing matches
        fallbackHref={(section, text) => {
          const cands = liveClusters(state).filter((c) => c.section === section);
          const i = bestMatchIndex(text, cands.map((c) => `${c.headline} ${(c.keywords ?? []).join(" ")}`));
          return i >= 0 ? storyHref.get(cands[i].id) : `/${section}`;
        }}
      />
    ) : null;
  return (
    <main
      className={`wrap page${showSidebar ? "" : " no-middle"}${gistLines.length > 0 ? " has-summary" : ""}`}
    >
      {preview ? (
        <div className="archive-banner" style={{ gridColumn: "1 / -1", marginBottom: 0 }}>
          Admin preview: showing the {preview} layout in this browser only. Visitors see the scheduled layout (
          {scheduledWeekend ? "weekend" : "weekday"} right now). Clear it in the <Link href="/admin#layout">admin</Link>.
        </div>
      ) : null}
      {/* editor-model gist of the news cycle; hidden once it goes stale. At
          weekends it reviews the week instead. Rendered twice: the above-nav
          copy is mobile's, the rail copy is desktop's (CSS shows one each). */}
      {summaryAt(true)}
      <ColumnHeads sections={cfg.sections} active="top" />
      <div className="stories-col">
        {leadWithWeek ? (
          <section className="week-review lead">
            <h2>Week&apos;s top stories</h2>
            <ul>
              {week.map((c) => {
                const lead = leadLink(c);
                return (
                  <li key={c.id} id={`s-${c.id}`}>
                    {/* same Techmeme-style kicker as every story card: the
                        vouching source reads first, on its own line */}
                    <div className="kicker">{lead.sourceName}:</div>
                    <a href={lead.url} rel="noopener">
                      {c.headline}
                    </a>{" "}
                    <Link href={`/story/${c.slug}`} className="week-review-permalink">
                      permalink
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        {/* not "also this weekend": stretched decay keeps genuinely older
            stories on the page, so the label must not claim they are new */}
        {leadWithWeek && latest.length > 0 ? <h2 className="list-label">More stories</h2> : null}
        {(() => {
          const ad = (state.sponsoredPosts ?? []).find((p) => !p.hidden && sponsoredPlacements(p).includes("top"));
          if (latest.length === 0) {
            // the week block already carries the page, so no empty state under it
            if (leadWithWeek) return ad ? <SponsoredCard post={ad} /> : null;
            return (
              <>
                {ad ? <SponsoredCard post={ad} /> : null}
                <p className="empty-state">
                  Catch up on the last few days in{" "}
                  {cfg.sections.map((s, i) => (
                    <span key={s.id}>
                      {i > 0 ? (i === cfg.sections.length - 1 ? " and " : ", ") : ""}
                      <Link href={`/${s.id}`}>{s.title}</Link>
                    </span>
                  ))}
                  , or watch new items land in the <Link href="/stream">Stream</Link> as sources publish.
                </p>
              </>
            );
          }
          return latest.flatMap((c, i) => {
            const card = <ClusterCard key={c.id} cluster={c} showSection />;
            // sponsored post sits after the 2nd story
            if (ad && i === Math.min(2, latest.length - 1)) {
              return [<SponsoredCard key="sponsored" post={ad} />, card];
            }
            return [card];
          });
        })()}
      </div>
      {showSidebar ? (
        <Sidebar
          jobs={state.jobs}
          events={state.events}
          podcasts={state.podcasts}
          announcement={state.announcement}
          sponsored={sidebarSponsored(state)}
        />
      ) : null}
      <NewestRail
        // an item whose story is already a card on this page would show the
        // same news twice (three times when two sources covered it), so the
        // rail keeps only items the page has not already told
        items={byPublished(state.items)
          .filter((i) => !i.clusterId || !shownIds.has(i.clusterId))
          .slice(0, 12)
          .map((i) => ({ ...i, rawTitle: i.title, title: itemDisplayTitle(state, i) }))}
        latestId={state.items[0]?.id}
        top={summaryAt(false)}
      />
    </main>
  );
}
