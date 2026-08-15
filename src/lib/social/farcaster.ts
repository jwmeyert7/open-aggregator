import type { SiteConfig, SiteState } from "../types";
import { utcDay } from "../util";

/**
 * Farcaster poster via Neynar (free tier). With no credentials or DRY_RUN=1
 * it records a dry-run entry instead of casting.
 */

export function farcasterPostedToday(state: SiteState): number {
  const today = utcDay(new Date().toISOString());
  return state.farcasterPosts.filter((p) => utcDay(p.postedAt) === today).length;
}

/** Send any cast (with an embedded link, optionally into a channel). Dry-runs without creds or with DRY_RUN=1. */
export async function castRaw(
  text: string,
  embedUrl?: string,
  channelId?: string
): Promise<{ dryRun: boolean; hash?: string }> {
  const apiKey = process.env.NEYNAR_API_KEY;
  const signer = process.env.FARCASTER_SIGNER_UUID;
  const dryRun = !apiKey || !signer || process.env.DRY_RUN === "1";
  if (dryRun) return { dryRun };
  const res = await fetch("https://api.neynar.com/v2/farcaster/cast", {
    method: "POST",
    headers: { "x-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      signer_uuid: signer,
      text,
      ...(embedUrl ? { embeds: [{ url: embedUrl }] } : {}),
      ...(channelId ? { channel_id: channelId } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Neynar API error ${res.status}: ${await res.text()}`);
  const json = await res.json().catch(() => ({}));
  return { dryRun, hash: json?.cast?.hash };
}

export async function postToFarcaster(
  state: SiteState,
  cluster: { id: string; headline: string; explainer: string; slug: string },
  cfg: SiteConfig["bots"]
): Promise<{ dryRun: boolean; hash?: string }> {
  const url = `${cfg.siteUrl}/story/${cluster.slug}`;
  const explainer = cluster.explainer
    ? cluster.explainer.charAt(0).toUpperCase() + cluster.explainer.slice(1)
    : "";
  const text = `${cluster.headline}\n\n${explainer ? `${explainer}\n\n` : ""}${url}`;

  const { dryRun, hash } = await castRaw(text, url);
  state.farcasterPosts.push({
    clusterId: cluster.id,
    postedAt: new Date().toISOString(),
    ...(dryRun ? { dryRun } : {}),
    ...(hash ? { hash } : {}),
  });
  return { dryRun, hash };
}
