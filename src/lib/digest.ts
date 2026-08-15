import { loadSiteConfig, siteUrl } from "./config";
import { sendMail } from "./mail";
import { siteIdentity } from "./site";
import { leadLink, liveClusters, magnitude, scoreBreakdown } from "./rank";
import { loadDailyDigest } from "./state";
import type { Cluster, DigestSubscriber, SiteConfig, SiteState } from "./types";
import { hoursAgo, parseSummaryLines, utcDay } from "./util";

/**
 * The email editions. The daily one is the frozen daily archive page in mail
 * form, sent right after the digest freezes at UTC midnight. The weekly one
 * goes out Saturday morning: a rollup of the prior Saturday to Friday assembled
 * from the frozen daily digests, ready to read over the weekend.
 */

/** First pipeline run at or after this UTC hour on Saturday sends the weekly. */
export const WEEKLY_SEND_HOUR_UTC = 11;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface MailStory {
  headline: string;
  explainer: string;
  url: string;
  source: string;
  permalink: string;
}

function toMailStories(clusters: Cluster[]): MailStory[] {
  return clusters.map((c) => {
    const lead = leadLink(c);
    return {
      headline: c.headline,
      explainer: c.explainer,
      url: lead.url,
      source: lead.sourceName,
      permalink: `${siteUrl()}/story/${c.slug}`,
    };
  });
}

/**
 * The clusters of one edition, arranged the way the emails read: the biggest
 * few stories first under "Top", then the rest grouped by section. Input
 * order is already the edition's ranking, so slicing keeps it.
 */
function groupStories(clusters: Cluster[]): Array<{ title: string; stories: MailStory[] }> {
  const groups = [{ title: "Top", stories: toMailStories(clusters.slice(0, 3)) }];
  const rest = clusters.slice(3);
  const sections = [...loadSiteConfig().sections.map((s) => ({ id: s.id, title: s.title })), { id: "general", title: "General" }];
  for (const s of sections) {
    const inSection = rest.filter((c) => c.section === s.id);
    if (inSection.length > 0) groups.push({ title: s.title, stories: toMailStories(inSection) });
  }
  return groups;
}

/**
 * Plain-text and HTML bodies for one edition. The HTML carries a %%UNSUB%%
 * placeholder so each recipient gets their own unsubscribe link.
 */
function digestEmail(opts: {
  heading: string;
  archiveUrl: string;
  archiveLabel: string;
  summary: string[];
  groups: Array<{ title: string; stories: MailStory[] }>;
}): { text: string; html: string } {
  const { heading, archiveUrl, archiveLabel, summary, groups } = opts;
  const text = [
    heading,
    "",
    ...summary.map((s) => `- ${s}`),
    summary.length > 0 ? "" : null,
    ...groups.flatMap((g) => [
      `== ${g.title} ==`,
      "",
      ...g.stories.flatMap((s) => [`${s.source}: ${s.headline}`, s.explainer || null, s.url, ""]),
    ]),
    `${archiveLabel}: ${archiveUrl}`,
    "",
    "Unsubscribe: %%UNSUB%%",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  const html = [
    `<div style="font-family: Georgia, serif; max-width: 640px; margin: 0 auto; color: #222; line-height: 1.5;">`,
    `<h1 style="font-size: 20px;">${escapeHtml(heading)}</h1>`,
    summary.length > 0
      ? `<ul style="padding-left: 20px;">${summary.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>`
      : "",
    ...groups.flatMap((g) => [
      `<h2 style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: #777; margin: 22px 0 4px; border-bottom: 1px solid #ddd; padding-bottom: 4px;">${escapeHtml(g.title)}</h2>`,
      ...g.stories.map(
        (s) =>
          `<p style="margin: 16px 0;"><span style="color: #777; font-size: 13px;">${escapeHtml(s.source)}:</span><br/>` +
          `<a href="${escapeHtml(s.url)}" style="font-size: 16px; font-weight: bold; color: #1a4b8f;">${escapeHtml(s.headline)}</a>` +
          (s.explainer ? `<br/><span style="font-size: 14px;">${escapeHtml(s.explainer)}</span>` : "") +
          `<br/><a href="${escapeHtml(s.permalink)}" style="font-size: 12px; color: #777;">permalink</a></p>`
      ),
    ]),
    `<p style="margin-top: 24px;"><a href="${escapeHtml(archiveUrl)}">${escapeHtml(archiveLabel)}</a></p>`,
    `<p style="font-size: 12px; color: #777;">You asked for this email at ${escapeHtml(siteUrl())}. ` +
      `<a href="%%UNSUB%%" style="color: #777;">Unsubscribe</a>.</p>`,
    `</div>`,
  ].join("\n");

  return { text, html };
}

/** One assembled edition, %%UNSUB%% placeholder and all. */
export interface Edition {
  subject: string;
  text: string;
  html: string;
}

/** "Sunday, August 9, 2026" for an edition heading. */
export function editionDateLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** The double-opt-in email: nothing else ever sends until its link is clicked. */
export function confirmationEmail(token: string): Edition {
  const name = siteIdentity().siteName;
  const url = `${siteUrl()}/api/subscribe?confirm=${token}`;
  return {
    subject: `Confirm your ${name} subscription`,
    text: [
      `Click to confirm your ${name} email subscription:`,
      "",
      url,
      "",
      `If you didn't sign up at ${siteUrl()}, ignore this email and nothing will ever be sent to you.`,
    ].join("\n"),
    html: [
      `<div style="font-family: Georgia, serif; max-width: 640px; margin: 0 auto; color: #222; line-height: 1.5;">`,
      `<p>Click to confirm your ${escapeHtml(name)} email subscription:</p>`,
      `<p><a href="${escapeHtml(url)}" style="font-size: 16px; font-weight: bold; color: #1a4b8f;">Confirm subscription</a></p>`,
      `<p style="font-size: 12px; color: #777;">If you didn't sign up at ${escapeHtml(siteUrl())}, ignore this email and nothing will ever be sent to you.</p>`,
      `</div>`,
    ].join("\n"),
  };
}

/** Send one edition to one address, unsubscribe link resolved. For admin test sends the link just points at /subscribe. */
export async function sendEditionTo(email: string, e: Edition, unsubUrl?: string): Promise<string | null> {
  const unsub = unsubUrl ?? `${siteUrl()}/subscribe`;
  return sendMail(email, e.subject, e.text.replace("%%UNSUB%%", unsub), e.html.replaceAll("%%UNSUB%%", unsub));
}

/** Subscribers eligible to receive anything: the confirmation link was clicked (or they predate double opt-in). */
function eligible(subs: DigestSubscriber[] | undefined, kind: "daily" | "weekly"): DigestSubscriber[] {
  return (subs ?? []).filter((s) => s[kind] && s.confirmed !== false);
}

/** Sequential sends (Gmail dislikes bursts); every failure is reported. */
async function sendToAll(subs: DigestSubscriber[], e: Edition): Promise<{ sent: number; errors: string[] }> {
  let sent = 0;
  const errors: string[] = [];
  for (const sub of subs) {
    const err = await sendEditionTo(sub.email, e, `${siteUrl()}/api/subscribe?unsub=${sub.token}`);
    if (err) errors.push(`${sub.email}: ${err}`);
    else sent += 1;
  }
  return { sent, errors };
}

/** The daily edition, assembled from a frozen daily digest. */
export function buildDailyEdition(digest: { date: string; clusters: Cluster[]; summary?: string }): Edition {
  const heading = `${siteIdentity().siteName}, ${editionDateLabel(digest.date)}`;
  return {
    subject: heading,
    ...digestEmail({
      heading,
      archiveUrl: `${siteUrl()}/day/${digest.date}`,
      archiveLabel: "Read this day on the site",
      summary: digest.summary ? parseSummaryLines(digest.summary).map((l) => l.text) : [],
      groups: groupStories(digest.clusters),
    }),
  };
}

/** Send the daily edition to confirmed daily subscribers. One line per outcome for the run log. */
export async function sendDailyEmail(
  state: SiteState,
  digest: { date: string; clusters: Cluster[]; summary?: string }
): Promise<string | null> {
  const subs = eligible(state.digestSubscribers, "daily");
  if (subs.length === 0) return null;
  const r = await sendToAll(subs, buildDailyEdition(digest));
  return `daily email: ${r.sent}/${subs.length} sent${r.errors.length > 0 ? ` (${r.errors.join("; ")})` : ""}`;
}

/**
 * The weekly edition: the prior Saturday to Friday's biggest stories, pulled from
 * the frozen daily digests (falling back to live clusters when the archive is
 * thin). Importance leads and magnitude breaks ties, same as the weekend page.
 */
export async function buildWeeklyEdition(state: SiteState, cfg: SiteConfig): Promise<Edition | null> {
  const days: string[] = [];
  for (let i = 7; i >= 1; i--) {
    days.push(utcDay(new Date(Date.now() - i * 24 * 60 * 60000).toISOString()));
  }
  const collected: Cluster[] = [];
  for (const d of days) {
    const digest = await loadDailyDigest(d);
    if (digest) collected.push(...digest.clusters);
  }
  let pool = collected;
  if (pool.length === 0) {
    const broke = (c: Cluster) =>
      c.links.reduce((min, l) => (l.publishedAt < min ? l.publishedAt : min), c.links[0]?.publishedAt ?? c.createdAt);
    pool = liveClusters(state).filter((c) => hoursAgo(broke(c)) <= 7 * 24);
  }
  if (pool.length === 0) return null;

  const eff = (c: Cluster) => {
    const b = scoreBreakdown(c, cfg.ranking);
    return b.importanceCapped ? 2 : c.importance;
  };
  const top = [...pool].sort((a, b) => eff(b) - eff(a) || magnitude(b, cfg.ranking) - magnitude(a, cfg.ranking)).slice(0, 10);

  const end = new Date(`${days[days.length - 1]}T00:00:00Z`);
  const label = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric" });
  const heading = `${siteIdentity().siteName} weekly, ${label(new Date(`${days[0]}T00:00:00Z`))} to ${label(end)}`;
  return {
    subject: heading,
    ...digestEmail({
      heading,
      archiveUrl: `${siteUrl()}/day`,
      archiveLabel: "Browse the daily archive",
      summary: [],
      groups: groupStories(top),
    }),
  };
}

/** Send the weekly edition to confirmed weekly subscribers. */
export async function sendWeeklyEmail(state: SiteState, cfg: SiteConfig): Promise<string | null> {
  const subs = eligible(state.digestSubscribers, "weekly");
  if (subs.length === 0) return null;
  const edition = await buildWeeklyEdition(state, cfg);
  if (!edition) return "weekly email: skipped, nothing to send";
  const r = await sendToAll(subs, edition);
  return `weekly email: ${r.sent}/${subs.length} sent${r.errors.length > 0 ? ` (${r.errors.join("; ")})` : ""}`;
}
