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
    // Discourse topic URLs carry the title as a slug that CHANGES when the
    // topic is renamed (an EIP renumbering renamed a thread and the same post
    // re-ingested as news). The numeric topic id is the stable identity, so
    // /t/<slug>/<topicId>[/<post>] collapses to /t/<topicId>. The title-based
    // content hash is the second dedupe key, so same-slug-new-id posts still
    // dedupe the other way.
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

/** Snapshot id like 250715-1430 (UTC). */
export function snapshotId(d: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

export function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

export function utcMonth(iso: string): string {
  return iso.slice(0, 7);
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

/** Site style rule: em dashes never appear in editorial copy, even if the LLM ignores the prompt. */
const ECHO_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "at", "as", "by", "with", "from", "after", "before",
  "its", "it", "is", "are", "was", "were", "be", "that", "this", "than", "then", "over", "into", "onto", "amid",
]);

function echoTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9$%.\s-]/g, " ")
      .split(/[\s-]+/)
      .filter((w) => w.length > 1 && !ECHO_STOPWORDS.has(w))
  );
}

/**
 * True when a summary bullet is really just one of the headlines shown beside
 * it. The editor is told not to restate headlines, but prompts are advisory and
 * a duplicated line looks like a bug to a reader, so the page enforces it.
 * Paraphrase and lines that draw a thread across several stories survive: only
 * near-verbatim restatements share this much of their vocabulary.
 */
export function echoesHeadline(line: string, headlines: string[], threshold = 0.7): boolean {
  const a = echoTokens(line);
  if (a.size === 0) return false;
  for (const h of headlines) {
    const b = echoTokens(h);
    if (b.size === 0) continue;
    let shared = 0;
    for (const t of a) if (b.has(t)) shared += 1;
    if (shared / Math.min(a.size, b.size) >= threshold) return true;
  }
  return false;
}

/**
 * Numbered standards-body proposals (RFC-9110, PEP-701, EIP-4337, and the
 * like) named in a piece of text, normalized to upper case with a hyphen. A
 * proposal number is a story identity: two texts naming disjoint numbers are
 * about different things, however similar their themes. Used by the
 * pipeline's clustering guard, since the LLM has blended one proposal's
 * number with another's title.
 */
export function proposalIds(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(RFC|PEP|EIP|ERC|RIP|FRP|CAIP)[-\s]?(\d{1,6})\b/gi)) {
    out.add(`${m[1].toUpperCase()}-${m[2]}`);
  }
  return out;
}

/** True when both sets name at least one proposal and share none: a hard identity conflict. */
export function proposalConflict(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  for (const id of a) if (b.has(id)) return false;
  return true;
}

/**
 * The proposal number a title formally claims, when the title is shaped like
 * a primary proposal thread ("EIP-8361: Transaction validity proofs"). Two
 * DIFFERENT posts both claiming the same number this way is a forum
 * numbering collision (it has happened: two threads both claimed one number,
 * one was later renumbered), which shared-number clustering would wrongly
 * merge.
 */
export function primaryProposalClaim(title: string): string | null {
  const m = /^\s*(RFC|PEP|EIP|ERC|RIP|FRP|CAIP)[-\s]?(\d{1,6})\s*:/i.exec(title);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : null;
}

/**
 * Best fuzzy match of a summary line against candidate story texts (headline
 * plus keywords), by shared meaningful tokens. Used to link a summary bullet
 * that carries no explicit story ref to the story it is plainly about. -1 when
 * nothing shares at least minShared tokens, so weak matches never link.
 */
export function bestMatchIndex(line: string, candidates: string[], minShared = 2): number {
  const a = echoTokens(line);
  let best = -1;
  let bestScore = 0;
  candidates.forEach((cand, i) => {
    const b = echoTokens(cand);
    let shared = 0;
    for (const t of a) if (b.has(t)) shared += 1;
    // overlap count leads; overlap density breaks ties between candidates
    const score = shared + shared / Math.max(b.size, 1);
    if (shared >= minShared && score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

export function stripEmDashes(s: string): string {
  return s.replace(/\s*—\s*/g, ", ").replace(/\s*--\s*/g, ", ");
}

export type SummarySection = string;

/**
 * Summary storage is a newline-joined string whose lines may carry a leading
 * "[<sectionId>]" marker so the UI can group bullets by section, optionally
 * extended to "[<sectionId>@<clusterId>]" when the editor tied the line to
 * one story (the UI then links the line to that story's card). Lines written
 * without markers parse with section null and render as one flat list.
 */
export function parseSummaryLines(
  text: string
): Array<{ section: SummarySection | null; ref: string | null; text: string }> {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap((l) => {
      const m = /^\[([a-z0-9-]+)(?:@([a-z0-9]+))?\]\s*(.*)$/.exec(l);
      const section = m ? (m[1] as SummarySection) : null;
      const ref = m ? (m[2] ?? null) : null;
      const body = m ? m[3] : l;
      // One bullet is one story. Semicolons are banned in editorial copy, so a
      // semicolon here means the editor packed two stories into one line:
      // split them into separate bullets. Only the first keeps the story ref;
      // the rest link like any refless bullet (fuzzy match on the front page).
      return body
        .split(/;\s*/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t, i) => ({
          section,
          ref: i === 0 ? ref : null,
          text: i === 0 ? t : t.charAt(0).toUpperCase() + t.slice(1),
        }));
    })
    .filter((l) => l.text);
}

/**
 * Server-side fetches of admin- or visitor-supplied URLs must never reach
 * internal infrastructure. Name-pattern check only: cheap, and catches the
 * loopback, link-local, and RFC-1918 targets that matter on typical hosts.
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}
