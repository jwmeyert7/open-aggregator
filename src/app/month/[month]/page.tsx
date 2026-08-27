import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClusterCard } from "@/components/ClusterCard";
import { DigestEpisodes } from "@/components/DigestEpisodes";
import { monthLabel } from "@/lib/digest";
import { siteIdentity } from "@/lib/site";
import { loadMonthlyDigest } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ month: string }> }): Promise<Metadata> {
  const { month } = await params;
  const digest = await loadMonthlyDigest(month);
  if (!digest) return {};
  const label = monthLabel(month);
  return {
    title: `${siteIdentity().siteName} monthly, ${label}`,
    description: `The ${digest.clusters.length} stories that mattered in ${label}.`,
  };
}

/**
 * One calendar month: frozen on the 1st of the next month, when the monthly
 * email, cast, and thread go out. Until then the current month renders here
 * too, flagged in progress and refreshed all day.
 */
export default async function MonthPage({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  const digest = await loadMonthlyDigest(month);
  if (!digest) notFound();

  return (
    <main className="wrap page single">
      <div>
        <div className="section-head">
          <h1>The month in review: {monthLabel(month)}</h1>
          {digest.inProgress ? (
            <p>
              <span className="live-dot" aria-hidden="true" />
              This month is still in progress. The list below updates all month and freezes on the 1st.
            </p>
          ) : (
            <p>The month&apos;s top ranked stories, frozen when the monthly edition went out.</p>
          )}
          <p>
            Individual days live in the <Link href="/day">daily archive</Link>
            {digest.tweetId ? (
              <>
                {" "}
                and this month was posted to{" "}
                <a href={`https://x.com/i/web/status/${digest.tweetId}`} rel="noopener" title="This month's thread on X">
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
            <h2 className="list-label">Top podcasts this month</h2>
            <DigestEpisodes episodes={digest.episodes} idPrefix="month" />
          </>
        ) : null}
      </div>
    </main>
  );
}
