import Link from "next/link";
import type { AdminChromeData } from "./shared";
import { effectiveFeeds } from "@/lib/config";
import { describeUnhealthyFeed, unhealthyFeeds } from "@/lib/feeds";
import { knownSourceHosts } from "@/lib/pipeline";
import { xMonthlyCount } from "@/lib/social/x";
import type { SiteConfig, SiteState, SourceCandidate } from "@/lib/types";

/**
 * Server-side helpers shared by the admin tool pages. Every page loads the
 * state it needs and hands the chrome strip the same summary numbers.
 */

/**
 * Domains Farcaster keeps linking that no source of ours covers, busiest
 * first. A candidate whose domain has since become a source is a stale
 * record awaiting expiry, not a decision, so it is hidden here.
 */
export function undecidedCandidates(state: SiteState): SourceCandidate[] {
  const covered = knownSourceHosts(state);
  return Object.values(state.sourceCandidates ?? {})
    .filter((c) => !c.dismissed && !covered.has(c.host))
    .sort((a, b) => b.casts - a.casts || b.engagement - a.engagement)
    .slice(0, 30);
}

export function buildChrome(state: SiteState, cfg: SiteConfig): AdminChromeData {
  return {
    riverCount: state.items.length,
    xMonthly: { used: xMonthlyCount(state), cap: cfg.bots.x.maxPerMonth },
    subscribers: {
      daily: (state.digestSubscribers ?? []).filter((s) => s.daily).length,
      weekly: (state.digestSubscribers ?? []).filter((s) => s.weekly).length,
    },
    updatedAt: state.updatedAt,
    unhealthyFeeds: unhealthyFeeds(state, effectiveFeeds(state), cfg.ingest).map((u) => ({
      id: u.feed.id,
      name: u.feed.name,
      kind: u.kind,
      ...describeUnhealthyFeed(u),
    })),
    submissions: (state.submissions ?? []).filter((s) => s.status === "pending").length,
    candidates: undecidedCandidates(state).length,
  };
}

export function NotLoggedIn() {
  return (
    <main className="wrap page single admin">
      <p className="status-line">
        Not logged in. <Link href="/admin">Go to the admin</Link> first.
      </p>
    </main>
  );
}
