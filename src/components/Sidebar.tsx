import Link from "next/link";
import { SponsoredCard } from "@/components/ClusterCard";
import { NewItemsButton } from "@/components/NewItemsButton";
import { AgeStamp } from "@/components/AgeStamp";
import { sponsoredPlacements, type Listing, type RiverItem, type SiteState, type SponsoredPost } from "@/lib/types";

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

/** Middle column: announcement slot + Jobs, Events, and Podcasts rails. Empty/hidden surfaces render nothing. */
export function Sidebar({
  jobs,
  events,
  podcasts = [],
  announcement,
  sponsored,
}: {
  jobs: Listing[];
  events: Listing[];
  podcasts?: Listing[];
  announcement?: SiteState["announcement"];
  sponsored?: SponsoredPost;
}) {
  const vJobs = visible(jobs);
  const vEvents = visible(events);
  const vPodcasts = visible(podcasts);
  return (
    <aside className="sidebar">
      {/* desktop column label; hidden on mobile where .sponsored-label takes over */}
      <div className="col-label">Sponsored</div>
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
      {vPodcasts.length > 0 ? <Rail title="Podcasts" items={vPodcasts} /> : null}
    </aside>
  );
}

/** Far-right column: the freshest items by publish time, Techmeme-style. */
export function NewestRail({
  items,
  latestId,
}: {
  items: Array<RiverItem & { rawTitle?: string }>;
  latestId?: string;
}) {
  return (
    <aside className="sidebar newest-col">
      {/* desktop column label; hidden on mobile where the rail's own h3 takes over */}
      <div className="col-label">Newest</div>
      <div className="rail">
        <NewItemsButton latestId={latestId} />
        <h3>Newest</h3>
        <ul>
          {items.length === 0 ? <li className="org">Nothing yet.</li> : null}
          {items.map((i) => (
            <li key={i.id} className="newest-item">
              <a href={i.url} rel="noopener" title={i.rawTitle && i.rawTitle !== i.title ? `Source title: ${i.rawTitle}` : undefined}>
                {i.title}
              </a>
              <div className="org">
                {i.sourceName} · <AgeStamp iso={i.publishedAt} />
              </div>
            </li>
          ))}
        </ul>
        <div className="rail-more">
          <Link href="/stream">full stream →</Link>
        </div>
      </div>
    </aside>
  );
}
