import { DistributionClient, type DistributionData } from "./DistributionClient";
import { buildChrome, NotLoggedIn } from "../server";
import { isAdmin } from "@/lib/auth";
import { loadSiteConfig } from "@/lib/config";
import { loadRecentMetrics } from "@/lib/metrics";
import { redditConfigured } from "@/lib/social/reddit";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin · Distribution", robots: { index: false } };

export default async function AdminDistributionPage() {
  if (!(await isAdmin())) return <NotLoggedIn />;

  const state = await loadState();
  const cfg = loadSiteConfig();
  const days = await loadRecentMetrics(14);

  // resolve clicked cluster ids to headlines while the clusters still exist;
  // stories aged out of state degrade to their bare id
  const stories: Record<string, { headline: string; slug?: string }> = {};
  for (const day of days) {
    for (const id of Object.keys(day.clicks.stories)) {
      if (stories[id]) continue;
      const c = state.clusters[id];
      stories[id] = c ? { headline: c.headline, slug: c.slug } : { headline: id };
    }
  }

  const data: DistributionData = {
    days,
    stories,
    reddit: {
      configured: redditConfigured(),
      enabled: Boolean(cfg.bots.reddit?.dailyComment),
      subreddit: cfg.bots.reddit?.subreddit ?? "",
      postHourUtc: cfg.bots.reddit?.postHourUtc ?? 10,
      posts: (state.redditPosts ?? []).slice(0, 14),
      lastAttemptAt: state.redditLastAttemptAt ?? null,
    },
  };
  return (
    <main className="wrap page single admin">
      <DistributionClient chrome={buildChrome(state, cfg)} data={data} />
    </main>
  );
}
