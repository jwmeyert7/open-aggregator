import fs from "node:fs";
import path from "node:path";
import { BlobNotFoundError, del, head, list, put } from "@vercel/blob";
import { sha256 } from "./util";

/**
 * Distribution metrics: who is actually consuming the machine surfaces (the
 * RSS feed, the MCP server) and what readers click through to. Entirely
 * separate from the pipeline's state store: request handlers must never race
 * the cron's state writes, so metrics get their own keys by construction.
 *
 * Storage follows the same lesson state.ts learned the hard way: Blob's CDN
 * serves overwritten-in-place files up to a minute stale, so read-modify-write
 * on a shared file silently resurrects old counts. Writers therefore only
 * append IMMUTABLE delta files (one per flush, unique name, no reads at write
 * time), and the pipeline cron compacts deltas into one rollup file per UTC
 * day. The rollup has a single writer (the cron, minutes apart), which keeps
 * its overwrite-in-place safe.
 *
 * Precision contract: counters are trend-level, not billing-grade. Events
 * buffer in module scope and flush inside after() callbacks; an instance
 * recycled before its next flush loses at most a few seconds of buffer, and
 * a delta whose delete fails after compaction can rarely count twice. Counts
 * can drift by a hair, structure cannot break.
 */

const DELTA_DIR = "aggregator/metrics/delta";
const ROLLUP_DIR = "aggregator/metrics/day";
const localDir = path.join(process.cwd(), ".data");
const FLUSH_EVERY_EVENTS = 20;
const FLUSH_EVERY_MS = 30_000;
const BUFFER_HARD_CAP = 500;
/** deltas younger than this stay uncompacted so an in-flight upload is never half-read */
const COMPACT_MIN_AGE_MS = 60_000;

export interface FeedReaderStat {
  /** highest subscriber count seen that day (a gauge, not a sum) */
  subs: number;
  hits: number;
  lastSeen: string;
}

export interface DayMetrics {
  date: string;
  feed: {
    /** function invocations, i.e. CDN misses only; the readers table is the audience number */
    hits: number;
    readers: Record<string, FeedReaderStat>;
    /** distinct callers that day, keyed by a salted hash of address and agent that cannot be reversed or joined across days */
    distinct?: Record<string, 1>;
  };
  mcp: {
    tools: Record<string, number>;
    /** initialize counts per clientInfo.name; the server is stateless, so this counts sessions, not unique users */
    clients: Record<string, number>;
    initializes: number;
    htmlViews: number;
    /** distinct callers that day, same keying as feed.distinct */
    distinct?: Record<string, 1>;
  };
  clicks: {
    total: number;
    stories: Record<string, number>;
    domains: Record<string, number>;
    sponsored: number;
  };
  /** site search: what readers typed (lowercased, trimmed) and how often nothing came back; absent on days before 2026-09-02 */
  searches?: {
    total: number;
    queries: Record<string, number>;
    /** queries that returned no story and no stream item */
    misses: Record<string, number>;
  };
}

type MetricEvent =
  | { date: string; kind: "feedHit"; reader?: { name: string; subs?: number }; who?: string }
  | { date: string; kind: "mcpTool"; tool: string; who?: string }
  | { date: string; kind: "mcpInit"; client?: string; who?: string }
  | { date: string; kind: "mcpHtml" }
  | { date: string; kind: "click"; clusterId?: string; domain?: string; sponsored?: boolean }
  | { date: string; kind: "search"; query: string; hits: number };

function emptyDay(date: string): DayMetrics {
  return {
    date,
    feed: { hits: 0, readers: {} },
    mcp: { tools: {}, clients: {}, initializes: 0, htmlViews: 0 },
    clicks: { total: 0, stories: {}, domains: {}, sponsored: 0 },
    searches: { total: 0, queries: {}, misses: {} },
  };
}

function useBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** Truncate and strip anything that has no business in a metrics key. */
function clean(name: string): string {
  return name.replace(/[^\w .:/+-]/g, "").slice(0, 60).trim() || "unknown";
}

/** Note one distinct caller for the day; past the cap the set stops growing and the count reads as "at least". */
function noteDistinct(map: Record<string, 1> | undefined, who: string | undefined, cap: number): Record<string, 1> | undefined {
  if (!who) return map;
  const m = map ?? {};
  if (m[who] === undefined && Object.keys(m).length >= cap) return m;
  m[who] = 1;
  return m;
}

/** How many distinct callers a day (or a merged bucket of days) saw. */
export function distinctCount(map: Record<string, 1> | undefined): number {
  return map ? Object.keys(map).length : 0;
}

/**
 * A caller's key for the day: a salted hash of the address and user agent,
 * 16 hex chars. The date is the salt, so the same reader is one key all day
 * and a different key tomorrow, which is what distinct-per-day needs and
 * nothing more. Nothing about the caller is stored or recoverable.
 */
function visitorKey(ip: string | null | undefined, userAgent: string | null | undefined): string | undefined {
  if (!ip) return undefined;
  return sha256(`${new Date().toISOString().slice(0, 10)}:${ip.trim()}:${userAgent ?? ""}`).slice(0, 16);
}

/** Bump map[key], folding overflow past the cap into "other" so a day file stays small. */
function bump(map: Record<string, number>, key: string, cap: number, by = 1): void {
  const k = clean(key);
  if (map[k] === undefined && Object.keys(map).length >= cap) {
    map.other = (map.other ?? 0) + by;
    return;
  }
  map[k] = (map[k] ?? 0) + by;
}

function applyEvent(day: DayMetrics, ev: MetricEvent): void {
  if (ev.kind === "feedHit") {
    day.feed.hits += 1;
    day.feed.distinct = noteDistinct(day.feed.distinct, ev.who, 5000);
    if (ev.reader) {
      const name = clean(ev.reader.name);
      const existing = day.feed.readers[name];
      if (!existing && Object.keys(day.feed.readers).length >= 50) return;
      day.feed.readers[name] = {
        subs: Math.max(existing?.subs ?? 0, ev.reader.subs ?? 0),
        hits: (existing?.hits ?? 0) + 1,
        lastSeen: new Date().toISOString(),
      };
    }
  } else if (ev.kind === "mcpTool") {
    bump(day.mcp.tools, ev.tool, 50);
    day.mcp.distinct = noteDistinct(day.mcp.distinct, ev.who, 5000);
  } else if (ev.kind === "mcpInit") {
    day.mcp.initializes += 1;
    bump(day.mcp.clients, ev.client ?? "unknown", 50);
    day.mcp.distinct = noteDistinct(day.mcp.distinct, ev.who, 5000);
  } else if (ev.kind === "mcpHtml") {
    day.mcp.htmlViews += 1;
  } else if (ev.kind === "search") {
    const s = (day.searches ??= { total: 0, queries: {}, misses: {} });
    s.total += 1;
    bump(s.queries, ev.query, 300);
    if (ev.hits === 0) bump(s.misses, ev.query, 100);
  } else if (ev.kind === "click") {
    day.clicks.total += 1;
    if (ev.sponsored) day.clicks.sponsored += 1;
    if (ev.clusterId) bump(day.clicks.stories, ev.clusterId, 400);
    if (ev.domain) bump(day.clicks.domains, ev.domain, 200);
  }
}

/** Fold src into target: counters add, subscriber gauges take the max. */
function mergeDay(target: DayMetrics, src: DayMetrics): void {
  target.feed.hits += src.feed.hits;
  for (const [name, r] of Object.entries(src.feed.readers)) {
    const existing = target.feed.readers[name];
    if (!existing && Object.keys(target.feed.readers).length >= 50) continue;
    target.feed.readers[name] = {
      subs: Math.max(existing?.subs ?? 0, r.subs),
      hits: (existing?.hits ?? 0) + r.hits,
      lastSeen: existing && existing.lastSeen > r.lastSeen ? existing.lastSeen : r.lastSeen,
    };
  }
  for (const [k, v] of Object.entries(src.mcp.tools)) bump(target.mcp.tools, k, 50, v);
  for (const [k, v] of Object.entries(src.mcp.clients)) bump(target.mcp.clients, k, 50, v);
  target.mcp.initializes += src.mcp.initializes;
  target.mcp.htmlViews += src.mcp.htmlViews;
  for (const who of Object.keys(src.feed.distinct ?? {})) target.feed.distinct = noteDistinct(target.feed.distinct, who, 5000);
  for (const who of Object.keys(src.mcp.distinct ?? {})) target.mcp.distinct = noteDistinct(target.mcp.distinct, who, 5000);
  target.clicks.total += src.clicks.total;
  target.clicks.sponsored += src.clicks.sponsored;
  for (const [k, v] of Object.entries(src.clicks.stories)) bump(target.clicks.stories, k, 400, v);
  for (const [k, v] of Object.entries(src.clicks.domains)) bump(target.clicks.domains, k, 200, v);
  if (src.searches) {
    const s = (target.searches ??= { total: 0, queries: {}, misses: {} });
    s.total += src.searches.total;
    for (const [k, v] of Object.entries(src.searches.queries)) bump(s.queries, k, 300, v);
    for (const [k, v] of Object.entries(src.searches.misses)) bump(s.misses, k, 100, v);
  }
}

// ---------- storage: immutable deltas + per-day rollups, blob or .data ----------

function localList(dir: string): string[] {
  const full = path.join(localDir, dir);
  return fs.existsSync(full) ? fs.readdirSync(full).filter((f) => f.endsWith(".json")) : [];
}

function localRead(name: string): string | null {
  const file = path.join(localDir, name);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function localWrite(name: string, body: string): void {
  const file = path.join(localDir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, file);
}

function deltaName(date: string): string {
  return `${date}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`;
}

/** "YYYY-MM-DD-<ms>-<rand>.json" -> its date and write time; null for anything else. */
function parseDeltaName(base: string): { date: string; ms: number } | null {
  const m = base.match(/^(\d{4}-\d{2}-\d{2})-(\d+)-\w+\.json$/);
  return m ? { date: m[1], ms: Number(m[2]) } : null;
}

async function writeDelta(day: DayMetrics): Promise<void> {
  const name = deltaName(day.date);
  const body = JSON.stringify(day);
  if (useBlob()) {
    // immutable: written once under a unique name, so CDN caching is harmless
    await put(`${DELTA_DIR}/${name}`, body, { access: "public", contentType: "application/json", addRandomSuffix: false });
  } else {
    localWrite(path.join("metrics", "delta", name), body);
  }
}

interface DeltaRef {
  base: string;
  date: string;
  ms: number;
  /** blob url when in blob mode */
  url?: string;
}

async function listDeltas(): Promise<DeltaRef[]> {
  const refs: DeltaRef[] = [];
  if (useBlob()) {
    const { blobs } = await list({ prefix: `${DELTA_DIR}/`, limit: 1000 });
    for (const b of blobs) {
      const parsed = parseDeltaName(b.pathname.slice(b.pathname.lastIndexOf("/") + 1));
      if (parsed) refs.push({ base: b.pathname.slice(b.pathname.lastIndexOf("/") + 1), ...parsed, url: b.url });
    }
  } else {
    for (const base of localList(path.join("metrics", "delta"))) {
      const parsed = parseDeltaName(base);
      if (parsed) refs.push({ base, ...parsed });
    }
  }
  return refs;
}

async function readDelta(ref: DeltaRef): Promise<DayMetrics | null> {
  try {
    if (ref.url) {
      const res = await fetch(ref.url, { cache: "no-store" });
      if (!res.ok) return null;
      return (await res.json()) as DayMetrics;
    }
    const raw = localRead(path.join("metrics", "delta", ref.base));
    return raw ? (JSON.parse(raw) as DayMetrics) : null;
  } catch {
    return null;
  }
}

async function readRollup(date: string): Promise<DayMetrics | null> {
  const pathname = `${ROLLUP_DIR}/${date}.json`;
  let raw: string | null = null;
  if (useBlob()) {
    try {
      const meta = await head(pathname);
      const res = await fetch(meta.url, { cache: "no-store" });
      if (!res.ok) return null;
      raw = await res.text();
    } catch (err) {
      if (err instanceof BlobNotFoundError) return null;
      return null;
    }
  } else {
    raw = localRead(path.join("metrics", "day", `${date}.json`));
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DayMetrics;
  } catch {
    return null;
  }
}

async function writeRollup(day: DayMetrics): Promise<void> {
  const body = JSON.stringify(day);
  if (useBlob()) {
    await put(`${ROLLUP_DIR}/${day.date}.json`, body, {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 0,
    });
  } else {
    localWrite(path.join("metrics", "day", `${day.date}.json`), body);
  }
}

// ---------- the in-process event buffer ----------

const buffer: MetricEvent[] = [];
let lastFlush = 0;
let flushing = false;

async function maybeFlush(): Promise<void> {
  if (flushing || buffer.length === 0) return;
  if (buffer.length < FLUSH_EVERY_EVENTS && Date.now() - lastFlush < FLUSH_EVERY_MS) return;
  flushing = true;
  const batch = buffer.splice(0, buffer.length);
  try {
    const byDate = new Map<string, DayMetrics>();
    for (const ev of batch) {
      const day = byDate.get(ev.date) ?? emptyDay(ev.date);
      applyEvent(day, ev);
      byDate.set(ev.date, day);
    }
    for (const day of byDate.values()) await writeDelta(day);
    lastFlush = Date.now();
  } catch {
    // put the batch back for a later flush, bounded so a dead store can't grow memory
    if (buffer.length + batch.length <= BUFFER_HARD_CAP) buffer.unshift(...batch);
  } finally {
    flushing = false;
  }
}

// distributive omit: plain Omit over the union would collapse it to "kind" only
type UndatedEvent = MetricEvent extends infer E ? (E extends MetricEvent ? Omit<E, "date"> : never) : never;

function record(ev: UndatedEvent): Promise<void> {
  const dated = { ...ev, date: new Date().toISOString().slice(0, 10) } as MetricEvent;
  if (buffer.length < BUFFER_HARD_CAP) buffer.push(dated);
  return maybeFlush();
}

// ---------- recording (all failures swallowed: metrics never break a response) ----------

const KNOWN_READERS = [
  "Feedbin",
  "Feedly",
  "Inoreader",
  "NewsBlur",
  "BazQux",
  "Miniflux",
  "FreshRSS",
  "Tiny Tiny RSS",
  "TheOldReader",
  "CommaFeed",
  "Newsboat",
  "NetNewsWire",
  "Reeder",
  "Feeder",
  "Unread",
];

/**
 * A feed reader announcing itself in the User-Agent, with its subscriber
 * count when it reports one ("Feedbin feed-id:123 - 42 subscribers"). Plain
 * browsers return null and count as an anonymous hit.
 */
export function parseFeedReader(ua: string): { name: string; subs?: number } | null {
  if (!ua) return null;
  const subsMatch = ua.match(/(\d[\d,]*)\s*(?:subscriber|reader)s?/i);
  const subs = subsMatch ? Number.parseInt(subsMatch[1].replaceAll(",", ""), 10) : undefined;
  const known = KNOWN_READERS.find((r) => ua.toLowerCase().includes(r.toLowerCase()));
  if (known) return { name: known, ...(subs !== undefined ? { subs } : {}) };
  if (subs !== undefined) {
    const product = ua.match(/^([A-Za-z][\w .-]{1,30}?)[/ ]/);
    return { name: product ? product[1] : "unknown reader", subs };
  }
  if (ua.includes("Mozilla/")) return null;
  const product = ua.match(/^([A-Za-z][\w .-]{1,30}?)[/ ]/);
  return product ? { name: product[1] } : null;
}

export async function recordFeedHit(userAgent: string | null, ip?: string | null): Promise<void> {
  try {
    const reader = parseFeedReader(userAgent ?? "");
    const who = visitorKey(ip, userAgent);
    await record({ kind: "feedHit", ...(reader ? { reader } : {}), ...(who ? { who } : {}) });
  } catch {}
}

export async function recordMcpHtmlView(): Promise<void> {
  try {
    await record({ kind: "mcpHtml" });
  } catch {}
}

/** One JSON-RPC message or a batch: count tools/call per tool and initialize per client. */
export async function recordMcpBody(body: unknown, ip?: string | null, userAgent?: string | null): Promise<void> {
  try {
    const who = visitorKey(ip, userAgent);
    const messages = Array.isArray(body) ? body : [body];
    for (const m of messages) {
      if (!m || typeof m !== "object") continue;
      const msg = m as { method?: unknown; params?: { name?: unknown; clientInfo?: { name?: unknown } } };
      if (msg.method === "tools/call" && typeof msg.params?.name === "string") {
        await record({ kind: "mcpTool", tool: msg.params.name, ...(who ? { who } : {}) });
      } else if (msg.method === "initialize") {
        const client = msg.params?.clientInfo?.name;
        await record({ kind: "mcpInit", ...(typeof client === "string" && client ? { client } : {}), ...(who ? { who } : {}) });
      }
    }
  } catch {}
}

/** One site search: the query as typed (normalized) and whether it found anything. Admin searches are not counted. */
export async function recordSearch(query: string, hits: number, isAdmin: boolean): Promise<void> {
  try {
    if (isAdmin) return;
    const q = query.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 60);
    if (!q) return;
    await record({ kind: "search", query: q, hits });
  } catch {}
}

/** Parse a click beacon body ({"k":"story"|"sp","id"?,"u"?}) and count it. */
export async function recordClick(raw: string, isAdmin: boolean): Promise<void> {
  try {
    if (isAdmin || !raw || raw.length > 512) return;
    const parsed = JSON.parse(raw) as { k?: unknown; id?: unknown; u?: unknown };
    if (parsed.k !== "story" && parsed.k !== "sp") return;
    let clusterId: string | undefined;
    if (typeof parsed.id === "string" && /^[\w-]{1,48}$/.test(parsed.id)) clusterId = parsed.id;
    let domain: string | undefined;
    if (typeof parsed.u === "string") {
      try {
        domain = new URL(parsed.u).hostname;
      } catch {}
    }
    await record({
      kind: "click",
      ...(clusterId ? { clusterId } : {}),
      ...(domain ? { domain } : {}),
      ...(parsed.k === "sp" ? { sponsored: true } : {}),
    });
  } catch {}
}

// ---------- reading and compaction ----------

/** One day: its rollup plus any deltas the cron hasn't compacted yet. */
export async function loadDayMetrics(date: string): Promise<DayMetrics | null> {
  try {
    const deltas = (await listDeltas()).filter((d) => d.date === date);
    return assembleDay(date, await readRollup(date), deltas);
  } catch {
    return null;
  }
}

async function assembleDay(date: string, rollup: DayMetrics | null, deltas: DeltaRef[]): Promise<DayMetrics | null> {
  const day = rollup ?? (deltas.length > 0 ? emptyDay(date) : null);
  if (!day) return null;
  for (const ref of deltas) {
    const delta = await readDelta(ref);
    if (delta) mergeDay(day, delta);
  }
  return day;
}

/** The last N UTC days that have any metrics, newest first. */
export async function loadRecentMetrics(days: number): Promise<DayMetrics[]> {
  try {
    const allDeltas = await listDeltas();
    const dates: string[] = [];
    for (let i = 0; i < days; i++) {
      dates.push(new Date(Date.now() - i * 24 * 60 * 60000).toISOString().slice(0, 10));
    }
    const loaded = await Promise.all(
      dates.map(async (date) => assembleDay(date, await readRollup(date), allDeltas.filter((d) => d.date === date)))
    );
    return loaded.filter((d): d is DayMetrics => d !== null);
  } catch {
    return [];
  }
}

/**
 * Every day in a window that has metrics, newest first, for the long views.
 * One listing call finds the rollups that exist, so a year back costs as
 * many fetches as there are recorded days, not one probe per calendar day.
 * Today's and yesterday's uncompacted deltas ride along like loadRecentMetrics.
 */
export async function loadMetricsRange(days: number): Promise<DayMetrics[]> {
  try {
    const since = new Date(Date.now() - (days - 1) * 24 * 60 * 60000).toISOString().slice(0, 10);
    // date -> blob url in blob mode, null in local mode, undefined when only deltas exist for the day
    const existing = new Map<string, string | null | undefined>();
    if (useBlob()) {
      const { blobs } = await list({ prefix: `${ROLLUP_DIR}/`, limit: 1000 });
      for (const b of blobs) {
        const date = b.pathname.slice(b.pathname.lastIndexOf("/") + 1).replace(/\.json$/, "");
        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date >= since) existing.set(date, b.url);
      }
    } else {
      for (const base of localList(path.join("metrics", "day"))) {
        const date = base.replace(/\.json$/, "");
        if (date >= since) existing.set(date, null);
      }
    }
    const allDeltas = (await listDeltas()).filter((d) => d.date >= since);
    for (const d of allDeltas) if (!existing.has(d.date)) existing.set(d.date, undefined);
    const loaded = await Promise.all(
      [...existing.entries()].map(async ([date, url]) => {
        let rollup: DayMetrics | null = null;
        if (url) {
          try {
            const res = await fetch(url, { cache: "no-store" });
            rollup = res.ok ? ((await res.json()) as DayMetrics) : null;
          } catch {
            rollup = null;
          }
        } else if (url === null) {
          rollup = await readRollup(date);
        }
        return assembleDay(date, rollup, allDeltas.filter((d) => d.date === date));
      })
    );
    return loaded.filter((d): d is DayMetrics => d !== null).sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];
  }
}

/** A day with nothing recorded, for charts that draw every bucket in a window. */
export function emptyMetrics(date: string): DayMetrics {
  return emptyDay(date);
}

/** ISO week's Monday for a date, as YYYY-MM-DD. */
function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Days folded into weeks or months for the long views: counts add up,
 * reader subscriber gauges take the max, and the bucket wears its first
 * day's date so the charts label it like a day. Newest first, like the input.
 */
export function bucketMetrics(days: DayMetrics[], by: "day" | "week" | "month"): DayMetrics[] {
  if (by === "day") return days;
  const keyOf = (date: string) => (by === "week" ? weekStart(date) : `${date.slice(0, 7)}-01`);
  const buckets = new Map<string, DayMetrics>();
  for (const d of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = keyOf(d.date);
    const target = buckets.get(key) ?? emptyDay(key);
    mergeDay(target, d);
    buckets.set(key, target);
  }
  return [...buckets.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Fold settled delta files into their day rollups and delete them. Called by
 * the pipeline cron, which makes the rollup single-writer. If a delete fails
 * after the rollup write, the leftover delta double-counts on the next run:
 * rare, bounded, and within the trend-level contract.
 */
export async function compactMetrics(): Promise<string | null> {
  try {
    const settled = (await listDeltas()).filter((d) => Date.now() - d.ms > COMPACT_MIN_AGE_MS);
    if (settled.length === 0) return null;
    const byDate = new Map<string, DeltaRef[]>();
    for (const d of settled) {
      const refs = byDate.get(d.date) ?? [];
      refs.push(d);
      byDate.set(d.date, refs);
    }
    for (const [date, refs] of byDate) {
      const day = (await assembleDay(date, await readRollup(date), refs)) ?? emptyDay(date);
      await writeRollup(day);
      if (useBlob()) {
        await del(refs.map((r) => r.url).filter((u): u is string => Boolean(u)));
      } else {
        for (const r of refs) {
          try {
            fs.unlinkSync(path.join(localDir, "metrics", "delta", r.base));
          } catch {}
        }
      }
    }
    return `metrics: compacted ${settled.length} delta file(s) into ${byDate.size} day(s)`;
  } catch (err) {
    return `metrics compaction failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}
