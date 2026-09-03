import { DistributionClient, type DistributionData } from "./DistributionClient";
import { buildChrome, NotLoggedIn } from "../server";
import { isAdmin } from "@/lib/auth";
import { applyBotOverrides, loadSiteConfig } from "@/lib/config";
import { bucketMetrics, emptyMetrics, loadMetricsRange } from "@/lib/metrics";
import { siteIdentity } from "@/lib/site";
import { redditConfigured } from "@/lib/social/reddit";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin · Distribution", robots: { index: false } };

const RANGES = { "14": 14, "30": 30, "90": 90, "365": 365, all: 3650 } as const;

export default async function AdminDistributionPage({ searchParams }: { searchParams: Promise<{ days?: string; by?: string }> }) {
  if (!(await isAdmin())) return <NotLoggedIn />;
  const sp = await searchParams;
  const rangeKey = (sp.days && sp.days in RANGES ? sp.days : "14") as keyof typeof RANGES;
  const by = sp.by === "week" || sp.by === "month" ? sp.by : "day";
  const windowDays = RANGES[rangeKey];

  const state = await loadState();
  const cfg = applyBotOverrides(loadSiteConfig(), state);
  const recorded = bucketMetrics(await loadMetricsRange(windowDays), by);

  // resolve clicked cluster ids to headlines while the clusters still exist;
  // stories aged out of state degrade to their bare id
  const stories: Record<string, { headline: string; slug?: string }> = {};
  for (const day of recorded) {
    for (const id of Object.keys(day.clicks.stories)) {
      if (stories[id]) continue;
      const c = state.clusters[id];
      stories[id] = c ? { headline: c.headline, slug: c.slug } : { headline: id };
    }
  }

  // signups over the same window and grouping, confirmed shading the honest number
  const subs = state.digestSubscribers ?? [];
  const since = new Date(Date.now() - (windowDays - 1) * 24 * 60 * 60000).toISOString().slice(0, 10);
  const bucketOf = (date: string) => {
    if (by === "day") return date;
    if (by === "month") return `${date.slice(0, 7)}-01`;
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const signupMap = new Map<string, { date: string; all: number; confirmed: number }>();
  // every bucket in the window appears, even an empty one, so gaps read as zero
  const step = by === "day" ? 1 : by === "week" ? 7 : 0;
  for (let t = new Date(`${since}T00:00:00Z`).getTime(); t <= Date.now(); ) {
    const key = bucketOf(new Date(t).toISOString().slice(0, 10));
    if (!signupMap.has(key)) signupMap.set(key, { date: key, all: 0, confirmed: 0 });
    if (step) t += step * 24 * 60 * 60000;
    else {
      const d = new Date(t);
      t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    }
  }
  for (const s of subs) {
    const day = s.addedAt.slice(0, 10);
    if (day < since) continue;
    const key = bucketOf(day);
    const b = signupMap.get(key) ?? { date: key, all: 0, confirmed: 0 };
    b.all += 1;
    if (s.confirmed !== false) b.confirmed += 1;
    signupMap.set(key, b);
  }
  const signups = [...signupMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  // the metric charts draw the same buckets as the signup chart, zeros included,
  // so a quiet day reads as quiet rather than vanishing (newest first, as before)
  const have = new Map(recorded.map((d) => [d.date, d]));
  const days = [...signupMap.keys()]
    .sort()
    .reverse()
    .map((key) => have.get(key) ?? emptyMetrics(key));
  const confirmed = subs.filter((s) => s.confirmed !== false);
  const data: DistributionData = {
    days,
    stories,
    view: { range: rangeKey, by, windowDays },
    analytics: {
      ...(process.env.VERCEL_ANALYTICS_URL || siteIdentity().analytics?.vercelUrl
        ? { vercelUrl: process.env.VERCEL_ANALYTICS_URL || siteIdentity().analytics?.vercelUrl }
        : {}),
      ...(process.env.GOOGLE_ANALYTICS_URL || siteIdentity().analytics?.googleUrl
        ? { googleUrl: process.env.GOOGLE_ANALYTICS_URL || siteIdentity().analytics?.googleUrl }
        : {}),
    },
    email: {
      signups,
      total: confirmed.length,
      unconfirmed: subs.length - confirmed.length,
      daily: confirmed.filter((s) => s.daily).length,
      weekly: confirmed.filter((s) => s.weekly).length,
      monthly: confirmed.filter((s) => s.monthly).length,
    },
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
