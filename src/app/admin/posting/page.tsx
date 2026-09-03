import { PostingClient, type PostingData } from "./PostingClient";
import { buildChrome, NotLoggedIn } from "../server";
import { isAdmin } from "@/lib/auth";
import { applyBotOverrides, loadSiteConfig } from "@/lib/config";
import { farcasterPostedToday } from "@/lib/social/farcaster";
import { siteIdentity } from "@/lib/site";
import { redditConfigured } from "@/lib/social/reddit";
import { xMonthlyCount } from "@/lib/social/x";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin · Posting", robots: { index: false } };

/**
 * What the bots post, per channel, switchable here without a config change.
 * The page shows the effective setting (config plus any override) and where
 * an override is in force.
 */
export default async function AdminPostingPage() {
  if (!(await isAdmin())) return <NotLoggedIn />;
  const state = await loadState();
  const base = loadSiteConfig();
  const cfg = applyBotOverrides(base, state);
  const o = state.botOverrides ?? {};
  const social = siteIdentity().social ?? {};

  const data: PostingData = {
    x: {
      handle: social.xHandle ?? "",
      dailyThread: cfg.bots.x.dailyThread !== false,
      weeklyThread: cfg.bots.x.weeklyThread !== false,
      monthlyThread: cfg.bots.x.monthlyThread !== false,
      maxAutoPerDay: cfg.bots.x.maxAutoPerDay,
      topN: cfg.bots.x.topN ?? 10,
      storyHourUtc: cfg.bots.x.storyHourUtc ?? 0,
      maxPerMonth: cfg.bots.x.maxPerMonth,
      usedThisMonth: xMonthlyCount(state),
      overridden: Object.keys(o.x ?? {}),
      configured: Boolean(process.env.X_API_KEY && process.env.X_ACCESS_TOKEN),
    },
    farcaster: {
      handle: social.farcasterHandle ?? "",
      dailyDigest: cfg.bots.farcaster.dailyDigest !== false,
      weeklyDigest: cfg.bots.farcaster.weeklyDigest !== false,
      monthlyDigest: cfg.bots.farcaster.monthlyDigest !== false,
      stories: cfg.bots.farcaster.stories !== false,
      maxPerDay: cfg.bots.farcaster.maxPerDay,
      topN: cfg.bots.farcaster.topN,
      storyHourUtc: cfg.bots.farcaster.storyHourUtc ?? 0,
      postedToday: farcasterPostedToday(state),
      channel: cfg.bots.farcaster.digestChannel ?? "",
      overridden: Object.keys(o.farcaster ?? {}),
      configured: Boolean(process.env.NEYNAR_API_KEY && process.env.FARCASTER_SIGNER_UUID),
    },
    reddit: {
      dailyComment: Boolean(cfg.bots.reddit?.dailyComment),
      postHourUtc: cfg.bots.reddit?.postHourUtc ?? 10,
      subreddit: cfg.bots.reddit?.subreddit ?? "",
      overridden: Object.keys(o.reddit ?? {}),
      configured: redditConfigured(),
    },
  };

  return (
    <main className="wrap page single admin">
      <PostingClient chrome={buildChrome(state, cfg)} data={data} />
    </main>
  );
}
