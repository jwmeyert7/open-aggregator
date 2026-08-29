import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClusterCard } from "@/components/ClusterCard";
import { DigestEpisodes } from "@/components/DigestEpisodes";
import { subjectRangeLabel } from "@/lib/digest";
import { siteIdentity } from "@/lib/site";
import { loadWeeklyDigest } from "@/lib/state";

export const dynamic = "force-dynamic";

function rangeLabel(start: string, end: string): string {
  return subjectRangeLabel(new Date(`${start}T00:00:00Z`), new Date(`${end}T00:00:00Z`));
}

export async function generateMetadata({ params }: { params: Promise<{ date: string }> }): Promise<Metadata> {
  const { date } = await params;
  const digest = await loadWeeklyDigest(date);
  if (!digest) return {};
  const label = rangeLabel(digest.start, digest.end);
  return {
    title: `${siteIdentity().siteName} weekly, ${label}`,
    description: `The ${digest.clusters.length} stories that mattered the week of ${label}.`,
  };
}

/**
 * One frozen week, Saturday through Friday, frozen the moment the weekly
 * email went out so the page, the email, and the weekly thread all tell the
 * same edition.
 */
export default async function WeekPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const digest = await loadWeeklyDigest(date);
  if (!digest) notFound();

  return (
    <main className="wrap page single">
      <div>
        <div className="section-head">
          <h1>The week in review: {rangeLabel(digest.start, digest.end)}</h1>
          {digest.inProgress ? (
            <p>
              <span className="live-dot" aria-hidden="true" />
              This week is still in progress. The list below updates all week and freezes Saturday morning.
            </p>
          ) : (
            <p>The week&apos;s top ranked stories, frozen when the weekly edition went out.</p>
          )}
          <p>
            Individual days live in the <Link href="/archive/daily">daily archive</Link>
            {digest.tweetId ? (
              <>
                {" "}
                and this week was posted to{" "}
                <a href={`https://x.com/i/web/status/${digest.tweetId}`} rel="noopener" title="This week's thread on X">
                  X
                </a>
              </>
            ) : null}
            .
          </p>
        </div>
        {digest.clusters.map((c) => (
          <ClusterCard key={c.id} cluster={c} showSection />
        ))}
        {digest.episodes && digest.episodes.length > 0 ? (
          <>
            <h2 className="list-label">Top podcasts this week</h2>
            <DigestEpisodes episodes={digest.episodes} idPrefix="week" />
          </>
        ) : null}
      </div>
    </main>
  );
}
