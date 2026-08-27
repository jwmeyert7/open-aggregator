import { loadSiteConfig, siteUrl } from "./config";
import { sendMail } from "./mail";
import { siteIdentity } from "./site";
import { leadLink, liveClusters, magnitude, scoreBreakdown } from "./rank";
import { loadDailyDigest } from "./state";
import type { Cluster, DigestSubscriber, SiteConfig, SiteState } from "./types";
import { formatDuration, parseSummaryLines, utcDay } from "./util";

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

/** One podcast or video episode for the Podcasts block of an edition. */
export interface MailEpisode {
  show: string;
  title: string;
  url: string;
  length?: string;
}

/**
 * The newest shelved episodes published inside a window, for the Podcasts
 * block: the daily takes the last day, the weekly the last week. Text only
 * (show, title, length, link): thumbnails are left out on purpose, mail
 * clients disagree about images and the block should never look broken.
 */
export function recentEpisodes(state: SiteState, windowHours: number, limit: number): MailEpisode[] {
  const since = Date.now() - windowHours * 60 * 60000;
  return (state.mediaItems ?? [])
    .filter((m) => !m.hidden && Date.parse(m.publishedAt) >= since)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, limit)
    .map((m) => {
      const length = formatDuration(m.durationSec);
      return { show: m.sourceName, title: m.displayTitle ?? m.title, url: `${siteUrl()}/podcasts?play=${m.id}#m-${m.id}`, ...(length ? { length } : {}) };
    });
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
  episodes?: MailEpisode[];
}): { text: string; html: string } {
  const { heading, archiveUrl, archiveLabel, summary, groups } = opts;
  const episodes = opts.episodes ?? [];
  const text = [
    heading,
    "",
    ...summary.map((s) => `- ${s}`),
    summary.length > 0 ? "" : null,
    ...groups.flatMap((g) => [
      `== ${g.title} ==`,
      "",
      ...g.stories.flatMap((s) => [`${s.source}: ${s.headline}`, s.explainer || null, s.permalink, ""]),
    ]),
    ...(episodes.length > 0
      ? ["== Podcasts ==", "", ...episodes.flatMap((e) => [`${e.show}: ${e.title}${e.length ? ` (${e.length})` : ""}`, e.url, ""])]
      : []),
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
          `<a href="${escapeHtml(s.permalink)}" style="font-size: 16px; font-weight: bold; color: #1a4b8f;">${escapeHtml(s.headline)}</a>` +
          (s.explainer ? `<br/><span style="font-size: 14px;">${escapeHtml(s.explainer)}</span>` : "") +
          `<br/><a href="${escapeHtml(s.url)}" style="font-size: 12px; color: #777;">read at ${escapeHtml(s.source)}</a></p>`
      ),
    ]),
    ...(episodes.length > 0
      ? [
          `<h2 style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: #777; margin: 22px 0 4px; border-bottom: 1px solid #ddd; padding-bottom: 4px;">Podcasts</h2>`,
          ...episodes.map(
            (e) =>
              `<p style="margin: 12px 0;"><span style="color: #777; font-size: 13px;">${escapeHtml(e.show)}:</span><br/>` +
              `<a href="${escapeHtml(e.url)}" style="font-size: 15px; font-weight: bold; color: #1a4b8f;">${escapeHtml(e.title)}</a>` +
              (e.length ? `<span style="font-size: 12px; color: #777;"> · ${escapeHtml(e.length)}</span>` : "") +
              `</p>`
          ),
          `<p style="font-size: 12px; color: #777; margin-top: 4px;"><a href="${escapeHtml(siteUrl())}/podcasts" style="color: #777;">All podcasts on the site</a></p>`,
        ]
      : []),
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

/** "August 15, 2026" for a daily subject line: no weekday. */
export function subjectDateLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Weekly subject range: "August 8-14, 2026" inside one month,
 * "August 29 - September 4, 2026" across months, and both years spelled out
 * when the week crosses New Year.
 */
export function subjectRangeLabel(start: Date, end: Date): string {
  const month = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "UTC", month: "long" });
  const day = (d: Date) => d.getUTCDate();
  if (start.getUTCFullYear() !== end.getUTCFullYear()) {
    return `${month(start)} ${day(start)}, ${start.getUTCFullYear()} - ${month(end)} ${day(end)}, ${end.getUTCFullYear()}`;
  }
  if (start.getUTCMonth() !== end.getUTCMonth()) {
    return `${month(start)} ${day(start)} - ${month(end)} ${day(end)}, ${end.getUTCFullYear()}`;
  }
  return `${month(start)} ${day(start)}-${day(end)}, ${end.getUTCFullYear()}`;
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
export function buildDailyEdition(
  digest: { date: string; clusters: Cluster[]; summary?: string },
  episodes: MailEpisode[] = []
): Edition {
  const heading = `${siteIdentity().siteName}, ${editionDateLabel(digest.date)}`;
  return {
    subject: `${siteIdentity().siteName} Daily Digest: ${subjectDateLabel(digest.date)}`,
    ...digestEmail({
      heading,
      archiveUrl: `${siteUrl()}/day/${digest.date}`,
      archiveLabel: "Read this day on the site",
      summary: digest.summary ? parseSummaryLines(digest.summary).map((l) => l.text) : [],
      groups: groupStories(digest.clusters),
      episodes,
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
  const r = await sendToAll(subs, buildDailyEdition(digest, recentEpisodes(state, 24, 3)));
  return `daily email: ${r.sent}/${subs.length} sent${r.errors.length > 0 ? ` (${r.errors.join("; ")})` : ""}`;
}

/**
 * The most recent COMPLETED Saturday to Friday week's biggest stories, pulled
 * from the frozen daily digests (falling back to live clusters when the
 * archive is thin). Anchoring to the completed week makes the weekly an
 * edition: an ad hoc mid-week send reproduces the same email Saturday's run
 * sent, instead of a trailing window that shifts with the send moment.
 * Importance leads and magnitude breaks ties, same as the weekend page.
 * Shared by the weekly email and the weekly cast.
 */
export async function weeklyTop(
  state: SiteState,
  cfg: SiteConfig
): Promise<{ top: Cluster[]; start: Date; end: Date } | null> {
  const daysSinceSat = (new Date().getUTCDay() + 1) % 7;
  const days: string[] = [];
  for (let i = daysSinceSat + 7; i >= daysSinceSat + 1; i--) {
    days.push(utcDay(new Date(Date.now() - i * 24 * 60 * 60000).toISOString()));
  }
  // A story big enough to top consecutive dailies appears in several of them:
  // keep one copy per cluster (the latest day's version) or a multi-day story
  // occupies several of the edition's slots.
  const byId = new Map<string, Cluster>();
  for (const d of days) {
    const digest = await loadDailyDigest(d);
    for (const c of digest?.clusters ?? []) byId.set(c.id, c);
  }
  let pool = [...byId.values()];
  if (pool.length === 0) {
    const start = `${days[0]}T00:00:00.000Z`;
    const endExclusive = new Date(
      new Date(`${days[days.length - 1]}T00:00:00Z`).getTime() + 24 * 60 * 60000
    ).toISOString();
    const broke = (c: Cluster) =>
      c.links.reduce((min, l) => (l.publishedAt < min ? l.publishedAt : min), c.links[0]?.publishedAt ?? c.createdAt);
    pool = liveClusters(state).filter((c) => broke(c) >= start && broke(c) < endExclusive);
  }
  if (pool.length === 0) return null;

  const eff = (c: Cluster) => {
    const b = scoreBreakdown(c, cfg.ranking);
    return b.importanceCapped ? 2 : c.importance;
  };
  const top = [...pool].sort((a, b) => eff(b) - eff(a) || magnitude(b, cfg.ranking) - magnitude(a, cfg.ranking)).slice(0, 10);
  return {
    top,
    start: new Date(`${days[0]}T00:00:00Z`),
    end: new Date(`${days[days.length - 1]}T00:00:00Z`),
  };
}

/** "August 10-16" or "August 29 - September 4", with years only when the week crosses New Year. */
export function shortRangeLabel(start: Date, end: Date): string {
  if (start.getUTCFullYear() !== end.getUTCFullYear()) return subjectRangeLabel(start, end);
  const month = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "UTC", month: "long" });
  if (start.getUTCMonth() !== end.getUTCMonth()) {
    return `${month(start)} ${start.getUTCDate()} - ${month(end)} ${end.getUTCDate()}`;
  }
  return `${month(start)} ${start.getUTCDate()}-${end.getUTCDate()}`;
}

/**
 * The Saturday weekly cast for the digest channel: the week's top three
 * headlines. Skipped when the week was too thin to rank three stories.
 */
export async function buildWeeklyCast(state: SiteState, cfg: SiteConfig): Promise<{ text: string; url: string } | null> {
  const week = await weeklyTop(state, cfg);
  if (!week || week.top.length < 3) return null;
  const site = siteIdentity();
  const lines = week.top.slice(0, 3).map((c, i) => `${i + 1}. ${c.headline}`);
  return {
    text: `This week in ${site.topic}, ${shortRangeLabel(week.start, week.end)}:\n\n${lines.join("\n")}\n\nFull week's news: ${site.domain}/day`,
    url: `${siteUrl()}/day`,
  };
}

/** The weekly edition email, assembled from the same weekly top. */
export async function buildWeeklyEdition(state: SiteState, cfg: SiteConfig, episodes?: MailEpisode[]): Promise<Edition | null> {
  const week = await weeklyTop(state, cfg);
  if (!week) return null;
  const { top, start, end } = week;
  const label = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric" });
  const heading = `${siteIdentity().siteName} weekly, ${label(start)} to ${label(end)}`;
  return {
    subject: `${siteIdentity().siteName} Weekly Digest: ${subjectRangeLabel(start, end)}`,
    ...digestEmail({
      heading,
      // the frozen weekly page exists by the time this sends (the pipeline
      // freezes the week first, then mails)
      archiveUrl: `${siteUrl()}/week/${end.toISOString().slice(0, 10)}`,
      archiveLabel: "Read this week on the site",
      summary: [],
      groups: groupStories(top),
      episodes: episodes ?? recentEpisodes(state, 7 * 24, 5),
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
