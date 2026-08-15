import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClusterCard } from "@/components/ClusterCard";
import { SummaryBlock } from "@/components/SummaryBlock";
import { loadSiteConfig } from "@/lib/config";
import { loadDailyDigest } from "@/lib/state";
import { siteIdentity } from "@/lib/site";
import { parseSummaryLines, truncate } from "@/lib/util";

export const dynamic = "force-dynamic";

function dateLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export async function generateMetadata({ params }: { params: Promise<{ date: string }> }): Promise<Metadata> {
  const { date } = await params;
  const digest = await loadDailyDigest(date);
  if (!digest) return {};
  return {
    title: `${siteIdentity().siteName}, ${dateLabel(date)}`,
    description: digest.summary
      ? truncate(
          parseSummaryLines(digest.summary)
            .map((l) => l.text)
            .join(" "),
          250
        )
      : `The ${digest.clusters.length} stories that mattered on ${dateLabel(date)}.`,
  };
}

export default async function DayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const digest = await loadDailyDigest(date);
  if (!digest) notFound();
  const fcHandle = siteIdentity().social?.farcasterHandle;

  return (
    <main className="wrap page single">
      <div>
        <div className="section-head">
          <h1>{siteIdentity().siteName}: {dateLabel(date)}</h1>
          <p>The day&apos;s top ranked stories.</p>
          <p>
            All days are in the <Link href="/day">daily archive</Link>
            {(digest.castHash && fcHandle) || digest.tweetId ? " and posted to " : ""}
            {digest.castHash && fcHandle ? (
              <a
                href={`https://farcaster.xyz/${fcHandle}/${digest.castHash.slice(0, 10)}`}
                rel="noopener"
                title="This day's post on Farcaster"
              >
                Farcaster
              </a>
            ) : null}
            {digest.castHash && fcHandle && digest.tweetId ? " and " : ""}
            {digest.tweetId ? (
              <a href={`https://x.com/i/web/status/${digest.tweetId}`} rel="noopener" title="This day's post on X">
                X
              </a>
            ) : null}
            .
          </p>
        </div>
        {digest.summary ? (
          <SummaryBlock
            sections={loadSiteConfig().sections.map((x) => ({ id: x.id, title: x.title }))}
            heading="The day in review"
            quietText="A quiet day here."
            text={digest.summary}
            storyHrefs={new Map(digest.clusters.map((c) => [c.id, `#s-${c.id}`]))}
          />
        ) : null}
        {digest.clusters.map((c) => (
          <ClusterCard key={c.id} cluster={c} showSection />
        ))}
      </div>
    </main>
  );
}
