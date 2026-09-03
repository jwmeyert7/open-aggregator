import { siteUrl } from "./config";

/**
 * UTM tagging for links WE publish that point back at our own site: tweets,
 * casts, and digest emails. Attribution then shows up in Vercel Analytics
 * and GA with no tracking machinery of our own (no redirects, no pixels,
 * a deliberate call for a privacy-conscious audience).
 */

export type UtmSource = "x" | "farcaster" | "email";

/**
 * Append utm params to one of our own URLs. Anything that is not our own
 * http(s) origin comes back untouched: publisher links must never carry
 * our campaign tags into their analytics. Existing query params, fragments,
 * and any utm_* already present are preserved.
 */
export function withUtm(url: string, source: UtmSource, campaign: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return url;
  let ownHost: string;
  try {
    ownHost = new URL(siteUrl()).hostname;
  } catch {
    return url;
  }
  if (u.hostname !== ownHost) return url;
  if (!u.searchParams.has("utm_source")) u.searchParams.set("utm_source", source);
  if (!u.searchParams.has("utm_medium")) u.searchParams.set("utm_medium", source === "email" ? "email" : "social");
  if (!u.searchParams.has("utm_campaign")) u.searchParams.set("utm_campaign", campaign);
  return u.toString();
}
