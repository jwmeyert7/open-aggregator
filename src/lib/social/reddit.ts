import type { Cluster, SiteConfig, SiteState } from "../types";
import { leadLink } from "../rank";
import { siteIdentity } from "../site";
import { withUtm } from "../utm";
import { truncate } from "../util";

/**
 * Reddit poster: one comment a day in a subreddit's daily discussion thread
 * with yesterday's frozen edition, the way regulars in such threads post
 * their own roundups. The subreddit and the thread's title prefix come from
 * config/sections.json under bots.reddit.
 *
 * Credentials (Vercel env): REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET from a
 * Reddit app, plus either REDDIT_REFRESH_TOKEN (minted once through
 * /api/admin/reddit-auth, works with 2FA) or REDDIT_USERNAME and
 * REDDIT_PASSWORD (script-app password grant, breaks with 2FA on). With
 * nothing set, or DRY_RUN=1, every call is a dry run that builds the text
 * and posts nothing.
 */

/** Reddit asks for a descriptive User-Agent naming the app and its operator. */
function userAgent(): string {
  const site = siteIdentity();
  return `web:${site.domain}:v1.0 (by /u/${process.env.REDDIT_USERNAME || site.siteName.replace(/\s+/g, "")})`;
}

export function redditConfigured(): boolean {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  const auth = process.env.REDDIT_REFRESH_TOKEN || (process.env.REDDIT_USERNAME && process.env.REDDIT_PASSWORD);
  return Boolean(id && secret && auth) && process.env.DRY_RUN !== "1";
}

async function accessToken(): Promise<string> {
  const id = process.env.REDDIT_CLIENT_ID!;
  const secret = process.env.REDDIT_CLIENT_SECRET!;
  const body = process.env.REDDIT_REFRESH_TOKEN
    ? new URLSearchParams({ grant_type: "refresh_token", refresh_token: process.env.REDDIT_REFRESH_TOKEN })
    : new URLSearchParams({
        grant_type: "password",
        username: process.env.REDDIT_USERNAME!,
        password: process.env.REDDIT_PASSWORD!,
      });
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": userAgent(),
    },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Reddit token error ${res.status}: ${truncate(await res.text(), 200)}`);
  const json = (await res.json()) as { access_token?: string; error?: string };
  if (!json.access_token) throw new Error(`Reddit token error: ${json.error ?? "no access_token"}`);
  return json.access_token;
}

async function api(token: string, path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`https://oauth.reddit.com${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "user-agent": userAgent() },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Reddit API error ${res.status} on ${path}: ${truncate(await res.text(), 200)}`);
  return res.json();
}

export interface DailyThread {
  id: string; // t3_xxx fullname
  title: string;
  url: string;
}

/**
 * The subreddit's current daily thread: the sticky whose title starts with
 * the configured prefix. Both sticky slots are checked, since the
 * daily's position moves when the mods pin something else above it.
 */
export async function findDailyThread(token: string, subreddit: string, titlePrefix: string): Promise<DailyThread | null> {
  for (const num of [1, 2]) {
    let json: unknown;
    try {
      json = await api(token, `/r/${subreddit}/about/sticky?num=${num}`);
    } catch {
      continue;
    }
    const post = (json as { data?: { children?: Array<{ data?: { name?: string; title?: string; permalink?: string } }> } })
      ?.data?.children?.[0]?.data;
    if (post?.name && post.title && post.title.toLowerCase().startsWith(titlePrefix.toLowerCase())) {
      return { id: post.name, title: post.title, url: `https://www.reddit.com${post.permalink ?? ""}` };
    }
  }
  return null;
}

/** "September 1" for the comment heading. */
function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric" });
}

/** The comment body in Reddit markdown: the edition's top stories, each linking the site and the source. */
export function buildDailyComment(
  digest: { date: string; clusters: Cluster[] },
  cfg: SiteConfig["bots"],
  topN: number
): string {
  const campaign = `reddit-daily-${digest.date}`;
  const lines: string[] = [`**${siteIdentity().siteName} top stories for ${dayLabel(digest.date)}**`, ""];
  digest.clusters.slice(0, topN).forEach((c, i) => {
    const lead = leadLink(c);
    const permalink = withUtm(`${cfg.siteUrl}/story/${c.slug}`, "reddit", campaign);
    const explainer = c.explainer ? ` ${c.explainer.charAt(0).toUpperCase()}${c.explainer.slice(1)}` : "";
    const via = lead ? ` (via [${lead.sourceName}](${lead.url}))` : "";
    lines.push(`${i + 1}. [${c.headline.replace(/[[\]]/g, "")}](${permalink})${via}.${truncate(explainer, 240)}`);
  });
  lines.push("");
  lines.push(
    `Full day on the site: ${withUtm(`${cfg.siteUrl}/day/${digest.date}`, "reddit", campaign)}. Daily email at ${withUtm(`${cfg.siteUrl}/subscribe`, "reddit", campaign)}.`
  );
  return lines.join("\n");
}

/**
 * Post the comment into the current daily thread. Dry-runs without
 * credentials, returning the text and no ids so the admin can preview.
 */
export async function postDailyComment(
  text: string,
  cfg: SiteConfig["bots"]
): Promise<{ dryRun: boolean; threadId?: string; threadUrl?: string; commentId?: string; commentUrl?: string }> {
  if (!redditConfigured()) return { dryRun: true };
  const token = await accessToken();
  const sub = cfg.reddit?.subreddit;
  if (!sub) throw new Error("bots.reddit.subreddit is not set in config/sections.json");
  const thread = await findDailyThread(token, sub, cfg.reddit?.dailyTitlePrefix ?? "Daily General Discussion");
  if (!thread) throw new Error(`no daily thread found among r/${sub}'s stickies`);
  const json = (await api(token, "/api/comment", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ api_type: "json", thing_id: thread.id, text }),
  })) as { json?: { errors?: unknown[]; data?: { things?: Array<{ data?: { id?: string; permalink?: string } }> } } };
  const errors = json.json?.errors ?? [];
  if (errors.length > 0) throw new Error(`Reddit rejected the comment: ${truncate(JSON.stringify(errors), 200)}`);
  const c = json.json?.data?.things?.[0]?.data;
  return {
    dryRun: false,
    threadId: thread.id,
    threadUrl: thread.url,
    ...(c?.id ? { commentId: c.id } : {}),
    ...(c?.permalink ? { commentUrl: `https://www.reddit.com${c.permalink}` } : {}),
  };
}

/** The record of a day's comment, if one was made (dry runs are not recorded). */
export function redditPostFor(state: SiteState, date: string) {
  return (state.redditPosts ?? []).find((p) => p.date === date);
}
