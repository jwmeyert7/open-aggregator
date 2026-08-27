import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClusterCard } from "@/components/ClusterCard";
import { DigestEpisodes } from "@/components/DigestEpisodes";
import { siteIdentity } from "@/lib/site";
import { loadYearlyDigest } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ year: string }> }): Promise<Metadata> {
  const { year } = await params;
  const digest = await loadYearlyDigest(year);
  if (!digest) return {};
  return {
    title: `${siteIdentity().siteName} yearly, ${year}`,
    description: `The ${digest.clusters.length} stories that mattered in ${year}.`,
  };
}

/**
 * One calendar year, pooled from the frozen monthly editions. Frozen on
 * January 1; until then the current year renders here too, flagged in
 * progress, a rolling "the year so far".
 */
export default async function YearPage({ params }: { params: Promise<{ year: string }> }) {
  const { year } = await params;
  const digest = await loadYearlyDigest(year);
  if (!digest) notFound();

  return (
    <main className="wrap page single">
      <div>
        <div className="section-head">
          <h1>The year in review: {year}</h1>
          {digest.inProgress ? (
            <p>
              <span className="live-dot" aria-hidden="true" />
              This year is still in progress. The list below updates all year and freezes on January 1.
            </p>
          ) : (
            <p>The year&apos;s top ranked stories, frozen on January 1.</p>
          )}
          <p>
            Individual days live in the <Link href="/day">daily archive</Link>.
          </p>
        </div>
        {digest.clusters.map((c) => (
          <ClusterCard key={c.id} cluster={c} showSection />
        ))}
        {digest.episodes && digest.episodes.length > 0 ? (
          <>
            <h2 className="list-label">Top podcasts, one per month</h2>
            <DigestEpisodes episodes={digest.episodes} idPrefix="year" />
          </>
        ) : null}
      </div>
    </main>
  );
}
