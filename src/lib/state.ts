import fs from "node:fs";
import path from "node:path";
import { BlobNotFoundError, del, head, list, put } from "@vercel/blob";
import { loadFeeds } from "./config";
import type { Cluster, DailyDigest, MonthlyDigest, SiteState, Snapshot, WeeklyDigest, YearlyDigest } from "./types";
import { emptyState } from "./types";

/**
 * Single-blob state store. On Vercel it lives in Vercel Blob; locally
 * (no BLOB_READ_WRITE_TOKEN) it falls back to .data/ on disk so the whole
 * pipeline can be developed and tested without any cloud resources.
 */

/**
 * State is written to a NEW versioned pathname on every save. Blob's public
 * CDN caches aggressively (~60s) and ignores cache-busting query strings, so
 * overwriting one file in place made reads stale and let admin edits get
 * clobbered. Versioned files are immutable (CDN cache is then harmless) and
 * the newest is found via list(), which is a consistent API call.
 */
const STATE_DIR = "aggregator/state";
const SNAPSHOT_DIR = "aggregator/snapshots";
const KEEP_VERSIONS = 3;
const localDir = path.join(process.cwd(), ".data");

function useBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * null means the blob DEFINITIVELY does not exist. Transient trouble (a CDN
 * hiccup, a 5xx, a timeout) retries with backoff and only then throws:
 * snapshot and daily pages read blobs directly, and before the retries a
 * single hiccup surfaced as a server error page mid-click.
 */
async function blobRead(pathname: string): Promise<string | null> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 250 * attempt));
    try {
      const meta = await head(pathname);
      const res = await fetch(meta.url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Blob fetch ${res.status} for ${pathname}`);
      return await res.text();
    } catch (err) {
      if (err instanceof BlobNotFoundError) return null;
      lastErr = err;
    }
  }
  throw lastErr;
}

/** null only when no version files exist at all; transient failures throw. */
async function readLatestStateVersion(): Promise<string | null> {
  const { blobs } = await list({ prefix: `${STATE_DIR}/v`, limit: 1000 });
  const versions = blobs.filter((b) => /\/v\d+\.json$/.test(b.pathname));
  if (versions.length === 0) return null;
  versions.sort((a, b) => (a.pathname < b.pathname ? 1 : -1));
  const res = await fetch(versions[0].url, { cache: "no-store" });
  if (!res.ok) throw new Error(`State version fetch ${res.status} for ${versions[0].pathname}`);
  return await res.text();
}

async function writeStateVersion(body: string): Promise<void> {
  await put(`${STATE_DIR}/v${Date.now()}.json`, body, {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });
  // best-effort prune of older versions
  try {
    const { blobs } = await list({ prefix: `${STATE_DIR}/v`, limit: 1000 });
    const versions = blobs
      .filter((b) => /\/v\d+\.json$/.test(b.pathname))
      .sort((a, b) => (a.pathname < b.pathname ? 1 : -1));
    const stale = versions.slice(KEEP_VERSIONS).map((b) => b.url);
    if (stale.length > 0) await del(stale);
  } catch {}
}

async function blobWrite(pathname: string, body: string): Promise<void> {
  await put(pathname, body, {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
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

/**
 * Sources hinted "general" publish multi-topic roundups (weekly newsletter
 * issues): a cluster sourced entirely from them belongs to no one section.
 * Cross-posts of the same issue from other sources (a reddit thread titled
 * "Ethereal news weekly #31 ...") count as roundup links too, matched by the
 * roundup feed's name in the link title, so a corroborated real story keeps
 * its section the moment a link that ISN'T the newsletter itself joins.
 * Normalizing at load rather than only at ingest retroactively refiles
 * clusters sectioned before this rule existed; the next saveState persists it.
 */
export function normalizeClusterSections(clusters: Cluster[]): void {
  const generalFeeds = loadFeeds().filter((f) => f.sectionHint === "general");
  if (generalFeeds.length === 0) return;
  const ids = new Set(generalFeeds.map((f) => f.id));
  const names = generalFeeds.map((f) => f.name.toLowerCase());
  const roundupLink = (l: Cluster["links"][number]) =>
    ids.has(l.sourceId) || names.some((n) => l.title.toLowerCase().includes(n));
  for (const c of clusters) {
    if (c.section !== "general" && c.links.length > 0 && c.links.some((l) => ids.has(l.sourceId)) && c.links.every(roundupLink)) {
      c.section = "general";
    }
  }
}

/**
 * A cluster with no links is editorial debris: the LLM emitted a cluster entry
 * whose items were all rejected or routed elsewhere (past runs saved these;
 * the pipeline now drops them at merge time). It has no lead link, so any page
 * that renders it crashes, and search hit exactly this. Pruning at load makes the
 * debris invisible immediately, and the next saveState erases it for good.
 */
export function dropLinklessClusters(clusters: Cluster[]): Cluster[] {
  return clusters.filter((c) => c.links.length > 0);
}

function normalizeSections(state: SiteState): SiteState {
  for (const [id, c] of Object.entries(state.clusters)) {
    if (c.links.length === 0) delete state.clusters[id];
  }
  normalizeClusterSections(Object.values(state.clusters));
  return state;
}

function parseState(raw: string): SiteState {
  let parsed: SiteState;
  try {
    parsed = JSON.parse(raw) as SiteState;
  } catch {
    // Never let a corrupt read wipe state implicitly; surface loudly.
    throw new Error("State blob exists but failed to parse. Refusing to overwrite: inspect it manually.");
  }
  return normalizeSections(parsed);
}

/**
 * The newest successfully parsed state, per server instance, kept as the raw
 * string so every caller still gets its own fresh mutable object. Served only
 * to render paths when the blob store is having a moment.
 */
let lastGoodRaw: string | null = null;

/**
 * Load site state. A transient blob failure retries with backoff, then render
 * paths fall back to this instance's last good copy: a hiccup must never
 * render the site as empty. Writers (pipeline, admin, submit) pass
 * fresh: true instead, because mutating and saving a stale copy would roll
 * the site back; for them a failed run that retries later is the safe outcome.
 * An empty state is returned only when the store definitively has no state:
 * a genuinely brand-new site.
 */
export async function loadState(opts: { fresh?: boolean } = {}): Promise<SiteState> {
  if (!useBlob()) {
    const raw = localRead("state.json");
    return raw ? parseState(raw) : emptyState();
  }
  let lastErr: unknown;
  const tries = opts.fresh ? 3 : 2;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 300 * attempt));
    let raw: string | null;
    try {
      raw = await readLatestStateVersion();
    } catch (err) {
      lastErr = err;
      continue;
    }
    if (raw === null) return emptyState();
    const state = parseState(raw);
    lastGoodRaw = raw;
    return state;
  }
  if (!opts.fresh && lastGoodRaw) return parseState(lastGoodRaw);
  throw new Error(`State store unreachable: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

export async function saveState(state: SiteState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  const body = JSON.stringify(state);
  if (useBlob()) await writeStateVersion(body);
  else localWrite("state.json", body);
}

export async function saveSnapshot(snap: Snapshot): Promise<void> {
  const body = JSON.stringify(snap);
  if (useBlob()) await blobWrite(`${SNAPSHOT_DIR}/${snap.id}.json`, body);
  else localWrite(path.join("snapshots", `${snap.id}.json`), body);
}

const DAILY_DIR = "aggregator/daily";
const WEEKLY_DIR = "aggregator/weekly";

export async function saveDailyDigest(digest: DailyDigest): Promise<void> {
  const body = JSON.stringify(digest);
  if (useBlob()) await blobWrite(`${DAILY_DIR}/${digest.date}.json`, body);
  else localWrite(path.join("daily", `${digest.date}.json`), body);
}

const MONTHLY_DIR = "aggregator/monthly";

export async function saveMonthlyDigest(digest: MonthlyDigest): Promise<void> {
  const body = JSON.stringify(digest);
  if (useBlob()) await blobWrite(`${MONTHLY_DIR}/${digest.month}.json`, body);
  else localWrite(path.join("monthly", `${digest.month}.json`), body);
}

export async function loadMonthlyDigest(month: string): Promise<MonthlyDigest | null> {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const raw = useBlob() ? await blobRead(`${MONTHLY_DIR}/${month}.json`) : localRead(path.join("monthly", `${month}.json`));
  if (!raw) return null;
  try {
    const digest = JSON.parse(raw) as MonthlyDigest;
    digest.clusters = dropLinklessClusters(digest.clusters);
    normalizeClusterSections(digest.clusters);
    return digest;
  } catch {
    return null;
  }
}

const YEARLY_DIR = "aggregator/yearly";

export async function saveYearlyDigest(digest: YearlyDigest): Promise<void> {
  const body = JSON.stringify(digest);
  if (useBlob()) await blobWrite(`${YEARLY_DIR}/${digest.year}.json`, body);
  else localWrite(path.join("yearly", `${digest.year}.json`), body);
}

export async function loadYearlyDigest(year: string): Promise<YearlyDigest | null> {
  if (!/^\d{4}$/.test(year)) return null;
  const raw = useBlob() ? await blobRead(`${YEARLY_DIR}/${year}.json`) : localRead(path.join("yearly", `${year}.json`));
  if (!raw) return null;
  try {
    const digest = JSON.parse(raw) as YearlyDigest;
    digest.clusters = dropLinklessClusters(digest.clusters);
    normalizeClusterSections(digest.clusters);
    return digest;
  } catch {
    return null;
  }
}

export async function saveWeeklyDigest(digest: WeeklyDigest): Promise<void> {
  const body = JSON.stringify(digest);
  if (useBlob()) await blobWrite(`${WEEKLY_DIR}/${digest.end}.json`, body);
  else localWrite(path.join("weekly", `${digest.end}.json`), body);
}

export async function loadWeeklyDigest(end: string): Promise<WeeklyDigest | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  const raw = useBlob() ? await blobRead(`${WEEKLY_DIR}/${end}.json`) : localRead(path.join("weekly", `${end}.json`));
  if (!raw) return null;
  try {
    const digest = JSON.parse(raw) as WeeklyDigest;
    digest.clusters = dropLinklessClusters(digest.clusters);
    normalizeClusterSections(digest.clusters);
    return digest;
  } catch {
    return null;
  }
}

export async function loadDailyDigest(date: string): Promise<DailyDigest | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const raw = useBlob()
    ? await blobRead(`${DAILY_DIR}/${date}.json`)
    : localRead(path.join("daily", `${date}.json`));
  if (!raw) return null;
  try {
    const digest = JSON.parse(raw) as DailyDigest;
    // frozen editions get the same roundup refiling and debris pruning as live state
    digest.clusters = dropLinklessClusters(digest.clusters);
    normalizeClusterSections(digest.clusters);
    return digest;
  } catch {
    return null;
  }
}

export async function loadSnapshot(id: string): Promise<Snapshot | null> {
  if (!/^\d{6}-\d{4}$/.test(id)) return null;
  const raw = useBlob()
    ? await blobRead(`${SNAPSHOT_DIR}/${id}.json`)
    : localRead(path.join("snapshots", `${id}.json`));
  if (!raw) return null;
  try {
    const snap = JSON.parse(raw) as Snapshot;
    // frozen editions get the same roundup refiling and debris pruning as live state
    snap.clusters = dropLinklessClusters(snap.clusters);
    normalizeClusterSections(snap.clusters);
    return snap;
  } catch {
    return null;
  }
}
