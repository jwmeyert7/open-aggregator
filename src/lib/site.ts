import fs from "node:fs";
import path from "node:path";

/**
 * The site's identity, read from config/site.json (falling back to the
 * tracked config/site.example.json so a fresh clone runs with zero setup).
 * Environment overrides: SITE_URL wins over the configured domain for the
 * canonical URL, MAIL_FROM wins for the outbound From: address.
 */
export interface SiteIdentity {
  /** Display name, used in the header wordmark, page titles, and emails. */
  siteName: string;
  /** Short line shown beside the wordmark and in social cards. */
  tagline: string;
  /** One phrase naming what the site covers, used in public page copy. */
  topic: string;
  /** Canonical domain (no scheme). SITE_URL overrides the derived URL. */
  domain: string;
  /** Public inbound contact address shown on contact/criteria/privacy pages. */
  contactEmail: string;
  /** Optional public account handles; empty strings hide the footer icons. */
  social?: { xHandle?: string; farcasterHandle?: string };
  /**
   * Writer pages (/by) and byline links are admin-only until this is true.
   * Bylines themselves still show in the kicker as plain text. Flip it once
   * the bylines coming out of your feeds look right.
   */
  writersPublic?: boolean;
}

const configDir = path.join(process.cwd(), "config");

let cached: SiteIdentity | null = null;

export function siteIdentity(): SiteIdentity {
  if (cached) return cached;
  for (const file of ["site.json", "site.example.json"]) {
    const full = path.join(configDir, file);
    if (fs.existsSync(full)) {
      cached = JSON.parse(fs.readFileSync(full, "utf8")) as SiteIdentity;
      return cached;
    }
  }
  cached = {
    siteName: "Open Aggregator",
    tagline: "a curated front page",
    topic: "the news",
    domain: "example.com",
    contactEmail: "you@example.com",
  };
  return cached;
}

/** Whether /by and the byline links are public (config writersPublic, default false). */
export function writersPublic(): boolean {
  return siteIdentity().writersPublic === true;
}

/** Outbound From: header. MAIL_FROM env wins, then the configured contact address. */
export function mailFrom(): string {
  return process.env.MAIL_FROM || siteIdentity().contactEmail;
}
