import crypto from "node:crypto";

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function newId(): string {
  return crypto.randomBytes(5).toString("hex");
}

/**
 * Loose text match for search: case-insensitive substring, tried again with
 * whitespace removed on both sides so "devtools" finds "Dev Tools Guild" and
 * "ethresearch" finds "ethresear.ch" written as "eth resear ch".
 */
export function looseIncludes(haystack: string | undefined, needle: string): boolean {
  if (!haystack) return false;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (!n) return false;
  return h.includes(n) || h.replace(/\s+/g, "").includes(n.replace(/\s+/g, ""));
}

/**
 * A pasted link finds the story that carries it. Exact after normalization
 * (tracking params, www, hash ignored), or the query as a fragment of the
 * link with scheme and www stripped, so a bare host or a partial path works
 * too. Needs a dot in the query so ordinary words never match link paths.
 */
export function urlMatches(candidate: string, query: string): boolean {
  const bare = (s: string) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  const q = bare(query);
  // without a dot the query is a word: it still finds links whose host or
  // path contains it once it is long enough not to hit everything
  if (!q.includes(".")) return q.length >= 5 && bare(candidate).includes(q);
  try {
    if (normalizeUrl(candidate) === normalizeUrl(/^https?:\/\//i.test(query.trim()) ? query.trim() : `https://${q}`)) return true;
  } catch {}
  return bare(candidate).includes(q);
}

/**
 * A feed's author field, made fit to show as a byline. Feeds put all sorts in
 * there: "By Jane Doe", an email, a URL, "Staff", the outlet's own name. Only
 * a plausible person's name (or names) survives; everything else is dropped
 * rather than shown wrong. Returns undefined when nothing usable remains.
 */
export function cleanByline(raw: string | undefined, sourceName?: string): string | undefined {
  if (!raw) return undefined;
  let s = stripHtml(raw).replace(/\s+/g, " ").trim();
  s = s.replace(/^by[:\s]+/i, "").replace(/[.,;\s]+$/g, "").trim();
  if (!s || s.length > 80) return undefined;
  if (/[@/]|https?:|\bwww\.|\[bot\]|\bbot\b/i.test(s)) return undefined;
  // "The Defiant Team", "CoinDesk Staff", "News Desk": a group, not a writer
  if (/\b(team|staff|desk|editors?|editorial|newsroom|contributors?|communications?|comms|pr)$/i.test(s)) return undefined;
  // a lowercase handle (github login, forum username) is not a byline
  if (!/[A-Z]/.test(s) && !/\s/.test(s)) return undefined;
  if (/^(staff|admin|administrator|editor|editors|editorial|team|newsroom|guest|contributor|anonymous|unknown|press release|pr newswire|reuters|bloomberg|ap)$/i.test(s)) return undefined;
  if (/\b(staff|team|desk|newsroom|editors?|news|media|research|labs?|foundation|dao|protocol)\b/i.test(s) && !/\s/.test(s.replace(/\b(staff|team|desk|newsroom|editors?|news|media|research|labs?|foundation|dao|protocol)\b/i, "").trim())) return undefined;
  if (sourceName && s.toLowerCase() === sourceName.toLowerCase()) return undefined;
  if (!/[a-z]/i.test(s)) return undefined;
  return s;
}

/**
 * The byline to show for a stored link, if any. Re-cleans at read time so
 * links stored before a rule tightened stop showing what it now rejects,
 * and hides release feeds, whose author is whoever clicked publish.
 */
export function showableByline(byline: string | undefined, sourceName: string): string | undefined {
  if (/\breleases?\b/i.test(sourceName)) return undefined;
  return cleanByline(byline, sourceName);
}

/** The people in a byline: "A, B and C" becomes ["A", "B", "C"]. */
export function bylineNames(byline: string): string[] {
  return byline
    .split(/\s*(?:,|;|&|\band\b|\+)\s*/i)
    .map((n) => n.trim())
    .filter((n) => n.length > 1);
}

/** URL segment for a writer's on-site page, derived from the display name. */
export function nameSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
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
 * one story (the UI then links the line to that story's card). A line naming
 * several stories may additionally wrap a phrase in "{phrase@<clusterId>}" so
 * that mention links to ITS story rather than the line's. Lines written
 * without markers parse with section null and render as one flat list.
 *
 * Each parsed line carries: `text` with every marker stripped (for email and
 * plain rendering), `raw` with inline phrase markers intact (for
 * re-serialization), and `segments`, the text split at phrase markers with
 * each linked phrase carrying its ref.
 */
export function parseSummaryLines(
  text: string
): Array<{
  section: SummarySection | null;
  ref: string | null;
  text: string;
  raw: string;
  segments: Array<{ text: string; ref: string | null }>;
}> {
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
        .map((raw, i) => {
          const segments: Array<{ text: string; ref: string | null }> = [];
          const re = /\{([^{}\n]+)@([a-z0-9]+)\}/g;
          let last = 0;
          for (let mm = re.exec(raw); mm; mm = re.exec(raw)) {
            if (mm.index > last) segments.push({ text: raw.slice(last, mm.index), ref: null });
            segments.push({ text: mm[1], ref: mm[2] });
            last = re.lastIndex;
          }
          if (last < raw.length) segments.push({ text: raw.slice(last), ref: null });
          if (i > 0 && segments[0]) segments[0].text = segments[0].text.charAt(0).toUpperCase() + segments[0].text.slice(1);
          const plain = segments.map((s) => s.text).join("");
          return { section, ref: i === 0 ? ref : null, text: plain, raw, segments };
        });
    })
    .filter((l) => l.text);
}

/**
 * The hashed core of a frozen edition: everything except post-freeze
 * bookkeeping. This is THE serialization contract behind contentHash and the
 * public verification flow (sha256 of JSON.stringify of this core, exactly),
 * shared by the freeze-time hasher and the edition.json download so the
 * downloaded bytes always re-hash to the sealed value. Change it and every
 * existing attestation stops verifying, so never change it.
 */
export function editionCore(digest: object): Record<string, unknown> {
  const { castHash, tweetId, contentHash, attestationUid, inProgress, ...core } = digest as Record<string, unknown>;
  void castHash; void tweetId; void contentHash; void attestationUid; void inProgress;
  return core;
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

/**
 * Social permalinks carry their author in the URL path, so a link from X or
 * Farcaster is attributed to the account ("@someuser on X"), never the bare
 * host. The form reads cleanly ahead of the kicker's own trailing colon.
 */
export function socialSourceName(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const seg = u.pathname.split("/").filter(Boolean)[0] ?? "";
    const named = Boolean(seg) && !["i", "search", "home", "hashtag", "intent", "explore", "~"].includes(seg);
    if (host === "x.com" || host === "twitter.com") return named ? `@${seg} on X` : "X";
    if (host === "farcaster.xyz" || host === "warpcast.com") return named ? `@${seg} on Farcaster` : "Farcaster";
  } catch {}
  return null;
}

/** "1h 12m" / "42m" for an episode length; null when unknown or zero. */
export function formatDuration(sec?: number): string | null {
  if (!sec || sec <= 0) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${Math.max(1, m)}m`;
}

/** "12:34" or "1:02:33" for a moment inside an episode. */
export function formatMoment(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The image an episode row should actually show. "frame" swaps YouTube's
 * designed card for a plain frame from the video itself (hq1.jpg), for shows
 * whose cards lead with exaggerated faces; "show" drops the image entirely so
 * the player renders a flat tile with the show's name instead.
 */
export function mediaThumb(m: {
  thumbnail?: string;
  thumbStyle?: "frame" | "frame2" | "frame3" | "show";
  url?: string;
  videoUrl?: string;
}): string | undefined {
  if (m.thumbStyle === "show") return undefined;
  if (m.thumbStyle?.startsWith("frame")) {
    const n = m.thumbStyle === "frame" ? 1 : Number(m.thumbStyle.slice(5));
    // derive the frame from the video id when there is one: a podcast episode's
    // stored thumbnail is the show's own artwork (not a YouTube URL), but its
    // video twin still has honest frames
    const id = watchId(m.videoUrl) ?? watchId(m.url);
    if (id) return `https://i.ytimg.com/vi/${id}/hq${n}.jpg`;
    if (m.thumbnail) return m.thumbnail.replace(/\/[a-z]*default\.jpg/, `/hq${n}.jpg`);
  }
  return m.thumbnail;
}

function watchId(u?: string): string | undefined {
  const m = u?.match(/(?:youtube\.com\/(?:watch\?v=|live\/|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m?.[1];
}

/** "9.7k" / "142k" / "1.2m" view counts. Null under a thousand: a small number advertises smallness, so the line simply omits it. */
export function formatViews(views?: number): string | null {
  if (!views || views < 1000) return null;
  if (views >= 1e6) return `${(views / 1e6).toFixed(views >= 1e7 ? 0 : 1)}m`;
  return `${(views / 1000).toFixed(views >= 10000 ? 0 : 1)}k`;
}
