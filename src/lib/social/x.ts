import crypto from "node:crypto";
import type { SiteConfig, SiteState } from "../types";
import { withUtm } from "../utm";
import { utcDay, utcMonth } from "../util";

/**
 * Capped X poster. The caps are enforced HERE, in code, unconditionally:
 *  - hard monthly cap (default 30 posts/calendar month, ~$6 at $0.20/post)
 *  - at most ONE automated post per UTC day, under any circumstances
 * Manual posts (admin button) share the monthly cap but not the daily auto cap.
 * With no credentials (or DRY_RUN=1) it records a dry-run entry instead of posting,
 * so the caps and logs are exercised end-to-end before real keys exist.
 */

export class XCapError extends Error {}

function creds() {
  const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET } = process.env;
  if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_SECRET) return null;
  return { key: X_API_KEY, secret: X_API_SECRET, token: X_ACCESS_TOKEN, tokenSecret: X_ACCESS_SECRET };
}

export function xMonthlyCount(state: SiteState): number {
  const month = utcMonth(new Date().toISOString());
  return state.xPosts.filter((p) => utcMonth(p.postedAt) === month).length;
}

export function xAutoPostedToday(state: SiteState): boolean {
  const today = utcDay(new Date().toISOString());
  return state.xPosts.some((p) => !p.manual && utcDay(p.postedAt) === today);
}

function pct(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** OAuth 1.0a user-context signature for the v2 create-tweet endpoint. */
function oauthHeader(url: string, c: NonNullable<ReturnType<typeof creds>>): string {
  const params: Record<string, string> = {
    oauth_consumer_key: c.key,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: c.token,
    oauth_version: "1.0",
  };
  const paramString = Object.keys(params)
    .sort()
    .map((k) => `${pct(k)}=${pct(params[k])}`)
    .join("&");
  const base = `POST&${pct(url)}&${pct(paramString)}`;
  const signingKey = `${pct(c.secret)}&${pct(c.tokenSecret)}`;
  params.oauth_signature = crypto.createHmac("sha1", signingKey).update(base).digest("base64");
  return (
    "OAuth " +
    Object.keys(params)
      .sort()
      .map((k) => `${pct(k)}="${pct(params[k])}"`)
      .join(", ")
  );
}

/**
 * Post a cluster's story to X, enforcing all caps. Mutates state.xPosts;
 * the caller is responsible for saving state afterwards.
 * Throws XCapError when a cap refuses the post.
 */
export async function postToX(
  state: SiteState,
  cluster: { id: string; headline: string; explainer: string; slug: string },
  cfg: SiteConfig["bots"],
  opts: { manual: boolean }
): Promise<{ dryRun: boolean }> {
  if (xMonthlyCount(state) >= cfg.x.maxPerMonth) {
    throw new XCapError(`Monthly X cap reached (${cfg.x.maxPerMonth}). Refusing to post.`);
  }
  if (!opts.manual && xAutoPostedToday(state)) {
    throw new XCapError("Already auto-posted to X today. Refusing to post.");
  }
  if (state.xPosts.some((p) => p.clusterId === cluster.id)) {
    throw new XCapError("This story was already posted to X.");
  }

  const url = withUtm(`${cfg.siteUrl}/story/${cluster.slug}`, "x", "story");
  const explainer = cluster.explainer ? cluster.explainer.charAt(0).toUpperCase() + cluster.explainer.slice(1) : "";
  const text = `${cluster.headline}\n\n${explainer ? `${explainer}\n\n` : ""}${url}`;

  const { dryRun } = await postTextToX(text);

  state.xPosts.push({ clusterId: cluster.id, postedAt: new Date().toISOString(), manual: opts.manual, ...(dryRun ? { dryRun } : {}) });
  return { dryRun };
}

/**
 * Send raw text as a tweet, optionally as a reply and with attached media.
 * No cap logic here: the digest threads are the callers, at a fixed handful
 * per day by construction. Dry-runs without credentials or with DRY_RUN=1.
 */
export async function postTextToX(
  text: string,
  opts: { replyTo?: string; mediaId?: string } = {}
): Promise<{ dryRun: boolean; id?: string }> {
  const c = creds();
  const dryRun = !c || process.env.DRY_RUN === "1";
  if (dryRun) return { dryRun };
  const endpoint = "https://api.x.com/2/tweets";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: oauthHeader(endpoint, c), "content-type": "application/json" },
    body: JSON.stringify({
      text,
      ...(opts.replyTo ? { reply: { in_reply_to_tweet_id: opts.replyTo } } : {}),
      ...(opts.mediaId ? { media: { media_ids: [opts.mediaId] } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`X API error ${res.status}: ${await res.text()}`);
  const json = (await res.json().catch(() => ({}))) as { data?: { id?: string } };
  return { dryRun, id: json?.data?.id };
}

/**
 * Upload one PNG for tweet attachment via the v2 simple media upload: one
 * multipart POST with the file in a `media` field (the old chunked
 * INIT/APPEND/FINALIZE command style is v1.1 and gets a 400 here). The
 * multipart body stays out of the OAuth signature, so the plain header
 * works. Returns null in dry-run; throws on an API refusal so the caller can
 * decide to post without the image.
 */
export async function uploadImageToX(png: Buffer): Promise<string | null> {
  const c = creds();
  if (!c || process.env.DRY_RUN === "1") return null;
  const endpoint = "https://api.x.com/2/media/upload";
  const fd = new FormData();
  fd.append("media", new Blob([new Uint8Array(png)], { type: "image/png" }), "card.png");
  fd.append("media_category", "tweet_image");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: oauthHeader(endpoint, c) },
    body: fd,
  });
  if (!res.ok) throw new Error(`X media upload ${res.status}: ${await res.text()}`);
  const json = (await res.json().catch(() => ({}))) as { data?: { id?: string } };
  if (!json.data?.id) throw new Error("X media upload returned no id");
  return json.data.id;
}
