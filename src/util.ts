import crypto from "node:crypto";

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function newId(): string {
  return crypto.randomBytes(5).toString("hex");
}

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    // strip common tracking params so the same article dedupes across feeds
    const strip = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "fbclid", "gclid"];
    for (const p of strip) u.searchParams.delete(p);
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    // Discourse topic URLs carry the title as a slug that changes when the topic
    // is renamed. The numeric topic id is the stable identity, so
    // /t/<slug>/<topicId>[/<post>] collapses to /t/<topicId>.
    const topic = /^\/t\/(?:[^/]+\/)?(\d+)(?:\/\d+)?$/.exec(u.pathname);
    if (topic) u.pathname = `/t/${topic[1]}`;
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return raw.trim();
  }
}

export function slugify(text: string, id: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .split("-")
    .slice(0, 8)
    .join("-");
  return `${base || "story"}-${id}`;
}

export function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

export function hoursAgo(iso: string, now: Date = new Date()): number {
  return (now.getTime() - new Date(iso).getTime()) / 3_600_000;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}

export function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** House style rule: em dashes and their lookalikes never appear in copy, even if the model ignores the prompt. */
export function stripEmDashes(s: string): string {
  return s.replace(/\s*—\s*/g, ", ").replace(/\s*–\s*/g, ", ").replace(/\s*--\s*/g, ", ");
}

/** Escape text for safe inclusion in HTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
