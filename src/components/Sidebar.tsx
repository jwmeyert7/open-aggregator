import Link from "next/link";
import { SponsoredCard } from "@/components/ClusterCard";
import { MediaPlayer } from "@/components/MediaPlayer";
import { MediaRail } from "@/components/MediaRail";
import { NewItemsButton } from "@/components/NewItemsButton";
import { AgeStamp } from "@/components/AgeStamp";
import type { NewestEntry } from "@/lib/rank";
import { sponsoredPlacements, type Listing, type MediaItem, type SiteState, type SponsoredPost } from "@/lib/types";

function Rail({ title, items }: { title: string; items: Listing[] }) {
  const featured = items.filter((l) => l.featured);
  const rest = items.filter((l) => !l.featured);
  return (
    <div className="rail">
      <h3>{title}</h3>
      <ul>
        {featured.map((l) => (
          <li key={l.id} className="featured">
            <span className="featured-tag">Featured</span>
            <br />
            <a href={l.url} rel="noopener">
              {l.title}
            </a>
            {l.org ? <span className="org"> · {l.org}</span> : null}
            {l.date ? <span className="org"> · {l.date}</span> : null}
          </li>
        ))}
        {rest.map((l) => (
          <li key={l.id}>
            <a href={l.url} rel="noopener">
              {l.title}
            </a>
            {l.org ? <span className="org"> · {l.org}</span> : null}
            {l.date ? <span className="org"> · {l.date}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

const visible = (items: Listing[] = []) => items.filter((l) => !l.hidden);

/** The sponsored post assigned to the middle column, if any is visible. */
export function sidebarSponsored(state: Pick<SiteState, "sponsoredPosts">): SponsoredPost | undefined {
  return (state.sponsoredPosts ?? []).find((p) => !p.hidden && sponsoredPlacements(p).includes("sidebar"));
}

/** True when the middle column has anything to show; pages collapse it otherwise. */
export function hasSidebarContent(
  state: Pick<SiteState, "jobs" | "events" | "podcasts" | "announcement" | "sponsoredPosts">
): boolean {
  return Boolean(
    (state.announcement?.text && !state.announcement.hidden) ||
      sidebarSponsored(state) ||
      visible(state.jobs).length > 0 ||
      visible(state.events).length > 0 ||
      visible(state.podcasts).length > 0
  );
}

/**
 * Middle column: announcement slot + Jobs, Events, and Sponsored Podcasts rails (all paid),
 * then the free Podcasts shelf. Empty/hidden surfaces render nothing. The
 * paid listing rail is called Shows so it never shares a name with the shelf.
 */
export function Sidebar({
  jobs,
  events,
  podcasts = [],
  announcement,
  sponsored,
  media = [],
  mediaLimit,
}: {
  jobs: Listing[];
  events: Listing[];
  podcasts?: Listing[];
  announcement?: SiteState["announcement"];
  sponsored?: SponsoredPost;
  /** Podcasts shelf episodes for this page (the front page passes all, a section page its own). */
  media?: MediaItem[];
  mediaLimit?: number;
}) {
  const vJobs = visible(jobs);
  const vEvents = visible(events);
  const vPodcasts = visible(podcasts);
  const hasSponsored = Boolean(
    (announcement?.text && !announcement.hidden) || sponsored || vJobs.length > 0 || vEvents.length > 0 || vPodcasts.length > 0
  );
  return (
    <aside className="sidebar">
      {/* desktop column label; hidden on mobile where .sponsored-label takes over. Only
          when there is sponsored content: otherwise the media block labels the column */}
      {hasSponsored ? <div className="col-label">Sponsored</div> : null}
      {announcement?.text && !announcement.hidden ? (
        <div className="sponsor-slot">
          {announcement.url ? (
            <a href={announcement.url} rel="noopener sponsored">
              {announcement.text}
            </a>
          ) : (
            announcement.text
          )}
        </div>
      ) : null}
      {sponsored ? <SponsoredCard post={sponsored} /> : null}
      {vJobs.length > 0 || vEvents.length > 0 || vPodcasts.length > 0 ? (
        <div className="sponsored-label">Sponsored</div>
      ) : null}
      {vJobs.length > 0 ? <Rail title="Jobs" items={vJobs} /> : null}
      {vEvents.length > 0 ? <Rail title="Events" items={vEvents} /> : null}
      {vPodcasts.length > 0 ? <Rail title="Sponsored Podcasts" items={vPodcasts} /> : null}
      {media.length > 0 ? <MediaRail items={media} limit={mediaLimit} /> : null}
    </aside>
  );
}

/** Far-right column: the freshest items by publish time, Techmeme-style. */
export function NewestRail({
  items,
  latestId,
  top,
  bottom,
}: {
  items: NewestEntry[];
  latestId?: string;
  /** Desktop-only block above the list (the front page parks Latest in here). */
  top?: React.ReactNode;
  /** Block below the list, for anything a page wants to park under Newest. */
  bottom?: React.ReactNode;
}) {
  return (
    <aside className="sidebar newest-col">
      {top}
      {/* desktop column label; hidden on mobile where the rail's own h3 takes over */}
      <div className="col-label">Newest</div>
      <div className="rail">
        <NewItemsButton latestId={latestId} />
        <h3>Newest</h3>
        <ul>
          {items.length === 0 ? <li className="org">Nothing yet.</li> : null}
          {items.map((i) =>
            i.episode ? (
              // an episode plays right here, same player as the Podcasts box
              <li key={i.id} className="newest-item newest-episode">
                <MediaPlayer
                  id={`newest-${i.episode.id}`}
                  url={i.episode.url}
                  kind={i.episode.kind}
                  title={i.episode.displayTitle ?? i.episode.title}
                  thumbnail={i.episode.thumbnail}
                  audioUrl={i.episode.audioUrl}
                  videoUrl={i.episode.videoUrl}
                  compact
                >
                  <div className="media-body">
                    <a href={i.url} rel="noopener" title={i.rawTitle && i.rawTitle !== i.title ? `Show's title: ${i.rawTitle}` : undefined}>
                      {i.title}
                    </a>
                    <div className="org">
                      <span className="kind-tag">podcast</span>
                      {i.sourceName} · <AgeStamp iso={i.publishedAt} />
                    </div>
                  </div>
                </MediaPlayer>
              </li>
            ) : (
              <li key={i.id} className="newest-item">
                <a href={i.url} rel="noopener" title={i.rawTitle && i.rawTitle !== i.title ? `Source title: ${i.rawTitle}` : undefined}>
                  {i.title}
                </a>
                <div className="org">
                  {i.sourceName} · <AgeStamp iso={i.publishedAt} />
                </div>
              </li>
            )
          )}
        </ul>
        <div className="rail-more">
          <Link href="/stream">full stream →</Link>
        </div>
      </div>
      {bottom}
    </aside>
  );
}
