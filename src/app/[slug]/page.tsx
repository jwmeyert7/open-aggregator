import { notFound } from "next/navigation";
import { ClusterCard, SponsoredCard } from "@/components/ClusterCard";
import { ColumnHeads } from "@/components/ColumnHeads";
import { SummaryBlock } from "@/components/SummaryBlock";
import { hasSidebarContent, NewestRail, Sidebar, sidebarSponsored } from "@/components/Sidebar";
import { loadSiteConfig } from "@/lib/config";
import { adaptiveRanking, newestEntries, rankMedia, sectionStories } from "@/lib/rank";
import { loadSnapshot, loadState } from "@/lib/state";
import { sponsoredPlacements, type SectionId } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * One dynamic segment serving two routes:
 *   /<sectionId>   (from config/sections.json) becomes that section's view
 *   /250715-1430   becomes an archived front page snapshot (UTC)
 */
export default async function SlugPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ req?: string }>;
}) {
  const { slug } = await params;
  const cfg = loadSiteConfig();

  if (/^\d{6}-\d{4}$/.test(slug)) {
    const snap = await loadSnapshot(slug);
    if (!snap) notFound();
    // /goto echoes what the reader asked for, so the page can show their
    // request resolving to this snapshot instead of leaving them to wonder
    // why the numbers differ from what they typed
    const { req } = await searchParams;
    const reqMatch = req ? /^(block|slot|t)-(.+)$/.exec(req) : null;
    const reqLabel = reqMatch && reqMatch[1] === "t" ? new Date(reqMatch[2]).toUTCString().replace("GMT", "UTC") : null;
    return (
      <main className="wrap page single">
        <div>
          <div className="archive-banner">
            {reqLabel ? (
              <>
                You asked for <strong>{reqLabel}</strong>: this is the archived front page closest to that moment.
                <br />
              </>
            ) : null}
            Archived front page snapshot from {new Date(snap.takenAt).toUTCString().replace("GMT", "UTC")}. Rankings
            and coverage are frozen as they were at that moment.
          </div>
          {snap.frontSummary ? (
            <SummaryBlock
              text={snap.frontSummary}
              sections={cfg.sections.map((s) => ({ id: s.id, title: s.title }))}
              // in-page jumps for the cards this frozen page shows, permalinks
              // for stories that ranked below its fold
              storyHrefs={
                new Map(
                  snap.clusters.map((c, i) => [c.id, i < cfg.ranking.maxTopStories ? `#s-${c.id}` : `/story/${c.slug}`])
                )
              }
            />
          ) : null}
          {snap.clusters.slice(0, cfg.ranking.maxTopStories).map((c) => (
            <ClusterCard key={c.id} cluster={c} showSection />
          ))}
        </div>
      </main>
    );
  }

  const section = cfg.sections.find((s) => s.id === slug);
  if (!section) notFound();

  const state = await loadState();
  const ranking = adaptiveRanking(state, cfg.ranking);
  const stories = sectionStories(state, section.id as SectionId, ranking);

  // the section's own episodes: section is a label on media, so an episode
  // lives on /podcasts and also here
  const sectionMedia = rankMedia(
    (state.mediaItems ?? []).filter((m) => !m.hidden && (m.roundup || m.section === section.id)),
    state,
    ranking
  ).slice(0, 40);
  const showSidebar = hasSidebarContent(state) || sectionMedia.length > 0;
  return (
    <main className={`wrap page${showSidebar ? "" : " no-middle"}`}>
      <ColumnHeads sections={cfg.sections} active={section.id} tagline={section.tagline} />
      <div className="stories-col">
        {(() => {
          const ad = (state.sponsoredPosts ?? []).find(
            (p) => !p.hidden && sponsoredPlacements(p).includes(section.id as SectionId)
          );
          if (stories.length === 0) {
            return (
              <>
                {ad ? <SponsoredCard post={ad} /> : null}
                <p className="empty-state">Nothing substantial in {section.title} right now.</p>
              </>
            );
          }
          return stories.flatMap((c, i) => {
            const card = <ClusterCard key={c.id} cluster={c} pageSection={section.id} />;
            if (ad && i === Math.min(2, stories.length - 1)) {
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
          media={sectionMedia}
          mediaLimit={5}
        />
      ) : null}
      <NewestRail
        // this section's own newest; when the section is quiet, the global
        // rail rather than a three-line box
        items={(() => {
          const own = newestEntries(state, 12, section.id as SectionId);
          return own.length >= 6 ? own : newestEntries(state, 12);
        })()}
        latestId={state.items[0]?.id}
      />
    </main>
  );
}
