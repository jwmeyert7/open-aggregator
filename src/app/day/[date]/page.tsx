import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClusterCard } from "@/components/ClusterCard";
import { DigestEpisodes } from "@/components/DigestEpisodes";
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
          {digest.inProgress ? (
            <p>
              <span className="live-dot" aria-hidden="true" />
              This day is still in progress. The list below updates all day and freezes at midnight UTC.
            </p>
          ) : (
            <p>The day&apos;s top ranked stories.</p>
          )}
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
          {digest.contentHash ? (
            <p className="day-colophon">
              edition hash:{" "}
              {digest.attestationUid ? (
                <a
                  className="edition-hash"
                  href={`https://base.easscan.org/attestation/view/${digest.attestationUid}`}
                  rel="noopener"
                  title="This edition's content hash, attested onchain the day it froze. Opens the attestation."
                >
                  {digest.contentHash}
                </a>
              ) : (
                <span className="edition-hash">{digest.contentHash}</span>
              )}
              {digest.attestationUid ? <> (attested onchain)</> : null}
            </p>
          ) : null}
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
        {digest.episodes && digest.episodes.length > 0 ? (
          <>
            <h2 className="list-label">Top podcasts this day</h2>
            <DigestEpisodes episodes={digest.episodes} idPrefix="day" />
          </>
        ) : null}
        {digest.alsoActive && digest.alsoActive.length > 0 ? (
          <>
            <h2 className="list-label">Also in the news this day</h2>
            <p className="sub">
              Stories that gathered new coverage this day but broke earlier, so they live on their own day&apos;s page.
            </p>
            <ul className="also-active">
              {digest.alsoActive.map((s) => (
                <li key={s.slug} className="newest-item">
                  <Link href={`/story/${s.slug}`}>{s.headline}</Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </main>
  );
}
