import Link from "next/link";
import { AdminEditLink } from "@/components/AdminEditLink";
import { AdminXray } from "@/components/AdminXray";
import { MentionLink } from "@/components/MentionLink";
import { AgeStamp } from "@/components/AgeStamp";
import type { Cluster, SponsoredPost } from "@/lib/types";
import { brokeAt, leadLink } from "@/lib/rank";
import { siteIdentity, writersPublic } from "@/lib/site";
import { sourceSlug } from "@/app/sources/shared";
import { bylineNames, nameSlug, showableByline } from "@/lib/util";

/**
 * The Techmeme-style kicker masthead: the vouching source's name reads first,
 * quietly linking its on-site source page (its articles or episodes here).
 * The headline below stays the loud click.
 */
export function SourceKicker({ name, byline }: { name: string; byline?: string }) {
  const shown = showableByline(byline, name);
  return (
    <div className="kicker">
      <Link href={`/sources/${sourceSlug(name)}`} title={`${name} on ${siteIdentity().siteName}`}>
        {name}
      </Link>
      {/* Techmeme-style byline: the outlet vouches, the writer gets the credit
          and (once writer pages are public) a page of their own */}
      {shown ? (
        <span className="byline">
          {" / "}
          {bylineNames(shown).map((n, i) => (
            <span key={n}>
              {i > 0 ? ", " : ""}
              {writersPublic() ? (
                <Link href={`/by/${nameSlug(n)}`} title={`${n} on ${siteIdentity().siteName}`}>
                  {n}
                </Link>
              ) : (
                n
              )}
            </span>
          ))}
        </span>
      ) : null}
      :
    </div>
  );
}

/**
 * Section tag linking to that section's page. "general" (multi-topic
 * roundups) has no section page, so its pill is inert.
 */
export function SectionPill({ section }: { section: string }) {
  if (section === "general") return <span className="pill general">general</span>;
  return (
    <Link href={`/${section}`} className="pill section">
      {section}
    </Link>
  );
}

/** A paid post inside the story list. Visually distinct so it's unmistakably an ad. */
export function SponsoredCard({ post }: { post?: SponsoredPost }) {
  return (
    <article className="cluster sponsored">
      {post ? (
        <>
          {post.sponsor ? <div className="kicker">{post.sponsor}:</div> : null}
          <h2>
            <a href={post.url} rel="noopener sponsored" data-oa-sp="1">
              {post.headline}
            </a>
          </h2>
          {post.description ? <p className="explainer">{post.description}</p> : null}
        </>
      ) : (
        <>
          <div className="kicker">your name here:</div>
          <h2>
            <a href={`mailto:${siteIdentity().contactEmail}`}>Sponsored post slot: your headline here</a>
          </h2>
        </>
      )}
      <div className="sponsored-tag">Sponsored</div>
    </article>
  );
}

export function ClusterCard({
  cluster,
  showSection = false,
  pageSection,
  debug,
}: {
  cluster: Cluster;
  showSection?: boolean;
  /** the section page this card sits on: its own label is implied there, any other label still shows */
  pageSection?: string;
  /** admin-only ranking X-ray, rendered as a quiet line under the card */
  debug?: string;
}) {
  // labels are labels, not buckets: a story wears every section it carries,
  // minus the one the page already stands for
  const labels = [cluster.section, ...(cluster.alsoIn ? [cluster.alsoIn] : [])].filter(
    (l) => showSection || l !== pageSection
  );
  const lead = leadLink(cluster);
  const others = cluster.links.filter((l) => l !== lead);
  // displayed age = when the story BROKE (earliest coverage): a straggling
  // late source must not make an old story read as breaking news. A final
  // release supersedes its own rc as the story's start (brokeAt), and any
  // other lead a day or more newer than the break shows as an update
  const broke = brokeAt(cluster);
  const updated = new Date(lead.publishedAt).getTime() - new Date(broke).getTime() >= 24 * 3600000 ? lead.publishedAt : null;
  const freshest = cluster.links.reduce(
    (max, l) => (l.publishedAt > max ? l.publishedAt : max),
    cluster.links[0]?.publishedAt ?? cluster.updatedAt
  );
  return (
    // the id anchors "Latest in" bullet links (#s-<clusterId>): a bullet jump
    // lands here and the :target style briefly highlights the card
    <article className="cluster" id={`s-${cluster.id}`}>
      {/* Techmeme-style kicker: the source vouching for the story reads first,
          on its own line, so trust anchors the headline without breaking its
          left edge for scanning */}
      <SourceKicker name={lead.sourceName} byline={lead.byline} />
      <h2>
        <a href={lead.url} rel="noopener" data-oa-story={cluster.id}>
          {cluster.headline}
        </a>
      </h2>
      {cluster.explainer ? (
        // older explainers completed the phrase "What this means: ..." and start lowercase
        <p className="explainer">{cluster.explainer.charAt(0).toUpperCase() + cluster.explainer.slice(1)}</p>
      ) : null}
      {others.length > 0 ? (
        <p className="coverage">
          {others.map((l, i) => (
            <span key={l.url}>
              {i > 0 ? " · " : "More: "}
              <a href={l.url} rel="noopener" title={showableByline(l.byline, l.sourceName) ? `${l.title} (by ${showableByline(l.byline, l.sourceName)})` : l.title} data-oa-story={cluster.id}>
                <span className="src">{l.sourceName}</span>
              </a>
            </span>
          ))}
        </p>
      ) : null}
      <div className="cluster-meta">
        {labels.map((l) => (
          <SectionPill key={l} section={l} />
        ))}
        {cluster.opinion ? (
          <span className="pill opinion" title="An opinion essay, not reporting. Admitted under the site's opinion exception">
            opinion
          </span>
        ) : null}
        <AgeStamp iso={broke} />
        {updated ? (
          <span className="updated-stamp" title="The lead link is newer than the story's first report">
            updated <AgeStamp iso={updated} />
          </span>
        ) : null}
        <Link
          href={`/story/${cluster.slug}`}
          title={`Permalink: story broke ${new Date(broke).toUTCString().replace("GMT", "UTC")}, newest coverage ${new Date(freshest).toUTCString().replace("GMT", "UTC")}`}
        >
          permalink
        </Link>
        {cluster.posted?.farcasterHash && siteIdentity().social?.farcasterHandle ? (
          <a
            href={`https://farcaster.xyz/${siteIdentity().social!.farcasterHandle}/${cluster.posted.farcasterHash.slice(0, 10)}`}
            rel="noopener"
            title="This story's post on Farcaster"
          >
            farcaster
          </a>
        ) : null}
        {(cluster.mentions ?? []).slice(0, 2).map((m) => (
          <MentionLink
            key={m.mediaId}
            mediaId={m.mediaId}
            at={m.at}
            href={`/podcasts?play=${m.mediaId}${m.at !== undefined ? `&t=${m.at}` : ""}#m-${m.mediaId}`}
            title={`${m.show}: ${m.title}`}
          >
            {m.at !== undefined ? `discussed at ${fmtMoment(m.at)} on ${m.show}` : `discussed on ${m.show}`}
          </MentionLink>
        ))}
        <AdminEditLink href={`/admin/stories?story=${cluster.id}`} />
        <a href={`/submit?story=${cluster.slug}`} className="suggest-link">
          suggest a link
        </a>
      </div>
      {debug ? (
        <AdminXray>
          <div className="org rank-debug">{debug}</div>
        </AdminXray>
      ) : null}
    </article>
  );
}

/** "12:34" or "1:02:33" for a moment inside an episode. */
function fmtMoment(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
