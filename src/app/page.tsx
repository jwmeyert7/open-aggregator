import Link from "next/link";
import { adminLayoutPreview, isAdmin } from "@/lib/auth";
import { scoreBreakdown } from "@/lib/rank";
import { AdminEditLink } from "@/components/AdminEditLink";
import { AdminXray } from "@/components/AdminXray";
import { AgeStamp } from "@/components/AgeStamp";
import { ClusterCard, SectionPill, SourceKicker, SponsoredCard } from "@/components/ClusterCard";
import { ColumnHeads } from "@/components/ColumnHeads";
import { MediaPlayer } from "@/components/MediaPlayer";
import { hasSidebarContent, NewestRail, Sidebar, sidebarSponsored } from "@/components/Sidebar";
import { SummaryBlock } from "@/components/SummaryBlock";
import { loadSiteConfig } from "@/lib/config";
import { maybeDevSeed } from "@/lib/devSeed";
import { adaptiveRanking, leadLink, liveClusters, newestEntries, rankMedia, sectionStories, summaryLinkable, topStories, weekendMode, weekInReview } from "@/lib/rank";
import { loadState } from "@/lib/state";
import { FRONT_SUMMARY_MAX_AGE_HOURS, sponsoredPlacements, type Cluster, type SectionId } from "@/lib/types";
import { bestMatchIndex, echoesHeadline, formatViews, hoursAgo, mediaThumb, parseSummaryLines } from "@/lib/util";

export const dynamic = "force-dynamic";

/** "3h 12m ago" for the X-ray log; minutes only under an hour. */
function ago(iso: string): string {
  const m = Math.max(0, Math.round(hoursAgo(iso) * 60));
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

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
  // the ranking X-ray: admins see each card's score arithmetic and when the
  // summary was last rewritten; visitors never do
  const admin = await isAdmin();
  const rankDebug = (c: Cluster): string => {
    const b = scoreBreakdown(c, ranking);
    return [
      `score ${b.total.toFixed(2)}`,
      `sources ${b.uniqueSources} (weight ${b.sourceWeight.toFixed(1)}, decayed ${b.decayedSourceWeight.toFixed(1)})`,
      b.velocityBoost > 0 ? `velocity +${b.velocityBoost.toFixed(1)} (${b.velocityLinks} fresh)` : null,
      `importance ${b.importance}${b.importanceCapped ? " (forum-capped)" : ""} ×${b.importanceFactor.toFixed(2)}`,
      b.forumFactor !== 1 ? `forum ×${b.forumFactor.toFixed(2)}` : null,
      b.centralityFactor !== 1 ? `centrality ×${b.centralityFactor.toFixed(2)}` : null,
      `decay ×${b.decay.toFixed(2)} (freshest ${Math.round(b.freshestAgeHours)}h, half-life ${Math.round(b.decayHalfLifeHours)}h)`,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const scheduledWeekend = weekendMode(cfg.ranking, new Date(), state.weekendSchedule);
  const weekend = preview ? preview === "weekend" : scheduledWeekend;
  const week = weekend ? weekInReview(state, ranking, new Set()) : [];
  const leadWithWeek = week.length >= 3;
  const weekIds = new Set(week.map((c) => c.id));
  const latestRanked = leadWithWeek ? stories.filter((c) => !weekIds.has(c.id)) : stories;
  // Weekend fallback. Top Stories never pads with weak stories, which is right
  // on a weekday, but after a quiet stretch the week block can be the only
  // thing that qualifies and the main column ends after five lines. Rather
  // than a blank page, show each section's current lead under a "Latest"
  // label. Weekdays keep the empty state.
  const weekendFallback =
    leadWithWeek && latestRanked.length === 0
      ? cfg.sections
          .map((sec) => sectionStories(state, sec.id as SectionId, ranking)[0])
          .filter((c): c is Cluster => Boolean(c) && !weekIds.has(c.id))
      : [];
  const latest = latestRanked.length > 0 ? latestRanked : weekendFallback;
  const belowLabel = latestRanked.length > 0 ? "More stories" : "Latest";
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

  // the Podcasts shelf lives in the middle column (below any sponsored content),
  // so the column is never blank and the right rail stays Newest
  const media = rankMedia((state.mediaItems ?? []).filter((m) => !m.hidden), state, ranking).slice(0, 40);
  const showSidebar = hasSidebarContent(state) || media.length > 0;
  // mobile only: the top-ranked episode rides at the bottom of the above-nav
  // summary box, so podcasts have a presence before the long scroll to the
  // rail. The desktop rail copy never renders it (the rail sits right there).
  // the box says "Latest in", so it carries the NEWEST episode (the ranked
  // pick still leads the rail); the kicker sits inside the text column so
  // the row packs as tight as the section groups above it
  const topEpisode = [...media].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0] ?? media[0];
  const episodeRow = topEpisode ? (
    <div className="front-summary-group summary-episode">
      <a className="front-summary-sec podcasts" href="/podcasts">Podcasts</a>
      <ul className="media-list">
        <li className="media-item">
          <MediaPlayer
            id={`gist-${topEpisode.id}`}
            url={topEpisode.url}
            kind={topEpisode.kind}
            title={topEpisode.displayTitle ?? topEpisode.title}
            thumbnail={mediaThumb(topEpisode)}
            tileText={topEpisode.sourceName}
            durationSec={topEpisode.durationSec}
            chapters={topEpisode.chapters}
            audioUrl={topEpisode.audioUrl}
            videoUrl={topEpisode.videoUrl}
            compact
          >
            <div className="media-body">
              <SourceKicker name={topEpisode.sourceName} />
              <a
                href={topEpisode.videoUrl ?? topEpisode.url}
                rel="noopener"
                title={topEpisode.displayTitle ? `Show's title: ${topEpisode.title}` : undefined}
              >
                {topEpisode.displayTitle ?? topEpisode.title}
              </a>
              <div className="org">
                {topEpisode.section ? <><SectionPill section={topEpisode.section} /> · </> : null}
                {formatViews(topEpisode.views) ? <>{formatViews(topEpisode.views)} views · </> : null}
                <AgeStamp iso={topEpisode.publishedAt} />{" "}
                <AdminEditLink href={`/admin/podcasts?episode=${topEpisode.id}`} />
              </div>
            </div>
          </MediaPlayer>
        </li>
      </ul>
    </div>
  ) : null;
  const summaryAt = (aboveNav: boolean) =>
    gistLines.length > 0 ? (
      <SummaryBlock
        aboveNav={aboveNav}
        sections={cfg.sections.map((s) => ({ id: s.id, title: s.title }))}
        heading={leadWithWeek ? "Week in review" : "Latest in"}
        quietText={leadWithWeek ? "A quiet week here." : undefined}
        text={gistLines.join("\n")}
        footer={aboveNav ? episodeRow : undefined}
        askEmail
        // a bullet's story jumps in page when its card is below, and falls
        // back to the story permalink when it ranks off the front page
        storyHrefs={storyHref}
        // a refless bullet fuzzy-matches to the story it is plainly about,
        // among stories active this week only (an old story with a similar
        // headline once won and sent a "Latest in" line 43 days back);
        // and stays plain text when nothing matches
        fallbackHref={(section, text) => {
          const cands = liveClusters(state).filter((c) => c.section === section && summaryLinkable(c));
          const i = bestMatchIndex(text, cands.map((c) => `${c.headline} ${(c.keywords ?? []).join(" ")}`));
          // no story to point at means no link: the section title above the
          // bullet already links the section page
          return i >= 0 ? storyHref.get(cands[i].id) : undefined;
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
          {scheduledWeekend ? "weekend" : "weekday"} right now). Clear it in the <Link href="/admin/layout">admin</Link>.
        </div>
      ) : null}
      {/* editor-model gist of the news cycle; hidden once it goes stale. At
          weekends it reviews the week instead. Rendered twice: the above-nav
          copy is mobile's, the rail copy is desktop's (CSS shows one each). */}
      {summaryAt(true)}
      <ColumnHeads sections={cfg.sections} active="top" />
      {admin && state.frontSummary ? (
        <AdminXray>
          <div className="org rank-debug summary-log" style={{ gridColumn: "1 / -1" }}>
            Latest in box: last confirmed by the editor {ago(state.frontSummary.at)}
            {state.frontSummary.stale ? ` · marked stale (${state.frontSummary.staleReason ?? "reason not recorded"})` : ""}
            {summary ? "" : " · hidden from visitors (over the freshness window)"}
            {(state.frontSummary.history ?? []).length > 0 ? (
              <ul>
                {(state.frontSummary.history ?? []).map((h) => (
                  <li key={h.at}>
                    {h.at.slice(11, 16)} UTC, {ago(h.at)}: {h.reason}
                    {h.diff && h.diff.length > 0 ? (
                      <ul className="summary-diff">
                        {h.diff.map((d, i) => (
                          <li key={i}>
                            <span className="sub">{d.section}</span>
                            {d.before ? <div className="diff-before">− {d.before}</div> : null}
                            {d.after ? <div className="diff-after">+ {d.after}</div> : null}
                            {d.why ? <div className="diff-why">why: {d.why}</div> : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <div>No rewrites logged yet (the log starts with the next change).</div>
            )}
          </div>
        </AdminXray>
      ) : null}
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
                    <SourceKicker name={lead.sourceName} byline={lead.byline} />
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
        {leadWithWeek && latest.length > 0 ? <h2 className="list-label">{belowLabel}</h2> : null}
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
            const card = <ClusterCard key={c.id} cluster={c} showSection debug={admin ? rankDebug(c) : undefined} />;
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
          media={media}
        />
      ) : null}
      <NewestRail
        // an item whose story is already a card on this page would show the
        // same news twice (three times when two sources covered it), so the
        // rail keeps only items the page has not already told; podcast
        // episodes ride along at their publish time
        items={newestEntries(state, 60)
          .filter((e) => {
            if (e.podcast) return true;
            const item = state.items.find((i) => i.id === e.id);
            return !item?.clusterId || !shownIds.has(item.clusterId);
          })
          .slice(0, 12)}
        latestId={state.items[0]?.id}
        top={summaryAt(false)}
      />
    </main>
  );
}
