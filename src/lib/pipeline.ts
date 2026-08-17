import { effectiveFeeds, effectiveMarkets, loadSiteConfig } from "./config";
import { buildWeeklyCast, sendDailyEmail, sendWeeklyEmail, WEEKLY_SEND_HOUR_UTC } from "./digest";
import { enrichNewItems, fetchAllFeeds, normalizeHost, updateFeedHealth, type FeedFetchResult } from "./feeds";
import { assessSourceCandidates, classifyAndCluster, dayInReview, heuristicFallback, llmAvailable, type EditorOutput, type SummaryBullet } from "./llm";
import { liveClusters, magnitude, rankClusters, score, scoreBreakdown, topStories, weekInReview, weekendMode } from "./rank";
import type { SiteConfig } from "./types";
import { polymarketQuote } from "./polymarket";
import { siteIdentity } from "./site";
import { castRaw, postToFarcaster, farcasterPostedToday } from "./social/farcaster";
import { postTextToX, postToX, xAutoPostedToday, xMonthlyCount, XCapError } from "./social/x";
import { loadState, saveDailyDigest, saveSnapshot, saveState } from "./state";
import { FRONT_SUMMARY_MAX_AGE_HOURS } from "./types";
import type { CandidateItem, Cluster, DailyDigest, SiteState } from "./types";
import { hoursAgo, newId, normalizeUrl, parseSummaryLines, primaryProposalClaim, proposalConflict, proposalIds, sha256, slugify, snapshotId, stripEmDashes, truncate, utcDay } from "./util";

/** Gate counters are kept a little longer than the leaderboard's 30 day window. */
export const SOURCE_STATS_RETENTION_DAYS = 35;

export interface RunReport {
  fetchedFeeds: number;
  feedErrors: Array<{ feedId: string; error: string }>;
  newItems: number;
  usedLlm: boolean;
  rejected: number;
  clustersCreated: number;
  clustersUpdated: number;
  snapshot?: string;
  posted: string[];
  notes: string[];
}

/**
 * Clusters worth showing the LLM as clustering context: recently active only,
 * bounded in count, so the per-run token cost stays flat as the archive grows.
 */
export function digestClusters(state: SiteState, cfg: SiteConfig["ingest"]): Cluster[] {
  return liveClusters(state)
    .filter((c) => hoursAgo(c.updatedAt) <= cfg.digestClusterDays * 24)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, cfg.digestMaxClusters);
}

function dedupeKeyUrl(url: string): string {
  return sha256(`url:${normalizeUrl(url)}`);
}

function dedupeKeyContent(title: string, sourceId: string): string {
  return sha256(`content:${sourceId}:${title.toLowerCase().trim()}`);
}

/** New = URL unseen AND content hash unseen. Also dedupes within the batch itself. */
export function selectNewItems(state: SiteState, candidates: CandidateItem[]): Array<CandidateItem & { id: string }> {
  const out: Array<CandidateItem & { id: string }> = [];
  const batchSeen = new Set<string>();
  for (const c of candidates) {
    const kUrl = dedupeKeyUrl(c.url);
    const kContent = dedupeKeyContent(c.title, c.sourceId);
    if (state.seen[kUrl] || state.seen[kContent] || batchSeen.has(kUrl) || batchSeen.has(kContent)) continue;
    batchSeen.add(kUrl);
    batchSeen.add(kContent);
    out.push({ ...c, id: kUrl.slice(0, 12) });
  }
  return out;
}

export function markSeen(state: SiteState, item: CandidateItem): void {
  const now = new Date().toISOString();
  state.seen[dedupeKeyUrl(item.url)] = now;
  state.seen[dedupeKeyContent(item.title, item.sourceId)] = now;
  // gnews items dedupe on the news.google.com form they'll arrive as next run;
  // enrichment replaced url/title with the publisher's after dedupe ran
  if (item.origUrl) state.seen[dedupeKeyUrl(item.origUrl)] = now;
  if (item.origTitle) state.seen[dedupeKeyContent(item.origTitle, item.sourceId)] = now;
}

/**
 * Summary bullets arrive as section-tagged objects; store as a newline-joined
 * string whose lines lead with a "[section]" marker (parseSummaryLines undoes
 * this), so older untagged summaries in state and snapshots stay readable.
 * A bullet the editor tied to a story carries that story's cluster id in the
 * marker ("[section@id]") so the UI can link the line to its card; refs are
 * kept only when they name a cluster that exists after this run's merge.
 */
function joinSummaryLines(lines: SummaryBullet[], resolveRef?: (ref: string) => string | undefined): string {
  return lines
    .flatMap((l) =>
      // one bullet is one story: a semicolon-packed line splits into separate
      // bullets before storage, the ref staying with the first piece
      stripEmDashes(l.text.trim().replace(/^[-•*]\s*/, ""))
        .split(/;\s*/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t, i) => ({
          section: l.section,
          ref: i === 0 ? l.ref : undefined,
          text: i === 0 ? t : t.charAt(0).toUpperCase() + t.slice(1),
        }))
    )
    .slice(0, 6)
    .map((l) => {
      const id = l.ref && resolveRef ? resolveRef(l.ref) : undefined;
      return `[${l.section}${id ? `@${id}` : ""}] ${truncate(l.text, 160)}`;
    })
    .join("\n");
}

/**
 * A run's summary only covers sections with fresh news, but the front page
 * boxes must never fall back to a "nothing notable" placeholder: a section
 * the new summary skips keeps its most recent line from the previous one, so
 * each box always shows the latest word written for that section.
 */
function carryForwardSummary(newText: string, prevText: string | undefined): string {
  if (!prevText) return newText;
  const covered = new Set(parseSummaryLines(newText).map((l) => l.section));
  const carried = parseSummaryLines(prevText)
    .filter((l) => l.section && !covered.has(l.section))
    .map((l) => `[${l.section}${l.ref ? `@${l.ref}` : ""}] ${l.text}`);
  return [newText, ...carried].join("\n");
}

/** Apply the editor's (LLM or fallback) decisions to state. Returns counts. */
/** The UI renders the "What this means:" label itself; strip it if the LLM echoes it. */
function cleanExplainer(raw: string): string {
  return truncate(stripEmDashes(raw.replace(/^\s*what (?:this|it) means[:,]?\s*/i, "").trim()), 280);
}

export function applyEditorOutput(
  state: SiteState,
  newItems: Array<CandidateItem & { id: string }>,
  out: EditorOutput
): {
  rejected: number;
  rejectedSamples: Array<{ title: string; source: string; reason: string }>;
  clustersCreated: number;
  clustersUpdated: number;
  touched: Set<string>;
  /** Editor refs (existing ids and new:N) to the cluster ids they ended up as. */
  clusterIdByRef: Map<string, string>;
  /** Human-readable records of every proposal-number guard intervention. */
  guardNotes: string[];
} {
  const now = new Date().toISOString();
  const byId = new Map(newItems.map((i) => [i.id, i]));
  const refToCluster = new Map<string, Cluster>();
  const guardNotes: string[] = [];
  let clustersCreated = 0;
  let clustersUpdated = 0;

  // The proposal-number guard: standards-proposal numbers are machine-checkable
  // identity, and the LLM has blended one proposal's number with another
  // proposal's title, so number claims are verified deterministically instead
  // of trusted.
  const itemProposals = (i: CandidateItem) => proposalIds(`${i.title} ${i.excerpt ?? ""}`);
  const linkProposals = (c: Cluster) => {
    const ids = new Set<string>();
    for (const l of c.links) for (const id of proposalIds(l.title)) ids.add(id);
    return ids;
  };
  const fmt = (ids: Set<string>) => [...ids].sort().join("/");
  // proposal numbers named by the items routed to each ref, for headline checks
  const proposalsByRef = new Map<string, Set<string>>();
  for (const d of out.items) {
    if (!d.pass || !d.clusterRef) continue;
    const item = byId.get(d.id);
    if (!item) continue;
    const set = proposalsByRef.get(d.clusterRef) ?? new Set<string>();
    for (const id of itemProposals(item)) set.add(id);
    proposalsByRef.set(d.clusterRef, set);
  }

  for (const c of out.clusters) {
    const headlineProposals = proposalIds(c.headline);
    if (c.ref.startsWith("new:")) {
      const id = newId();
      const cluster: Cluster = {
        id,
        slug: slugify(c.headline, id),
        headline: stripEmDashes(truncate(c.headline, 140)),
        explainer: cleanExplainer(c.explainer),
        section: c.section,
        links: [],
        importance: Math.max(1, Math.min(5, Math.round(c.importance))),
        centrality: Math.max(1, Math.min(5, Math.round(c.centrality ?? 3))),
        keywords: c.keywords,
        ...(c.opinion ? { opinion: true } : {}),
        createdAt: now,
        updatedAt: now,
      };
      // a new headline naming a number none of its items name is unverifiable
      // at best and a chimera at worst; it ships flagged for the editor
      if (proposalConflict(headlineProposals, proposalsByRef.get(c.ref) ?? new Set())) {
        cluster.needsReview = true;
        guardNotes.push(
          `Proposal guard: new headline "${truncate(c.headline, 70)}" names ${fmt(headlineProposals)} but its items name ${fmt(proposalsByRef.get(c.ref)!)}; flagged for review.`
        );
      }
      state.clusters[id] = cluster;
      refToCluster.set(c.ref, cluster);
      clustersCreated += 1;
    } else {
      const existing = state.clusters[c.ref];
      if (!existing) continue; // the LLM referenced a cluster we don't have, so ignore it
      // identity comes from the links (and this batch's items), NOT the old
      // headline: the old headline may itself be the error being corrected
      const identity = linkProposals(existing);
      for (const id of proposalsByRef.get(c.ref) ?? []) identity.add(id);
      if (proposalConflict(headlineProposals, identity)) {
        existing.needsReview = true;
        existing.updatedAt = now;
        refToCluster.set(c.ref, existing); // items may still join; each faces its own guard
        guardNotes.push(
          `Proposal guard: update "${truncate(c.headline, 70)}" names ${fmt(headlineProposals)} but the story's material names ${fmt(identity)}; kept the previous headline, flagged for review.`
        );
        continue;
      }
      existing.headline = stripEmDashes(truncate(c.headline, 140));
      existing.explainer = cleanExplainer(c.explainer);
      existing.section = c.section;
      existing.importance = Math.max(1, Math.min(5, Math.round(c.importance)));
      existing.centrality = Math.max(1, Math.min(5, Math.round(c.centrality ?? 3)));
      existing.keywords = c.keywords;
      if (c.opinion !== undefined) existing.opinion = c.opinion;
      existing.updatedAt = now;
      refToCluster.set(c.ref, existing);
      clustersUpdated += 1;
    }
  }

  let rejected = 0;
  const rejectedSamples: Array<{ title: string; source: string; reason: string }> = [];
  const touched = new Set<string>();
  // items pulled out of a cluster whose proposal numbers conflict with theirs,
  // keyed by (ref, numbers) so same-number items still land together
  const quarantined = new Map<string, Cluster>();
  const today = utcDay(now);
  const countGate = (sourceId: string, accepted: boolean) => {
    const bySource = (state.sourceStats ??= {});
    const days = (bySource[sourceId] ??= {});
    const bucket = (days[today] ??= { considered: 0, accepted: 0 });
    bucket.considered += 1;
    if (accepted) bucket.accepted += 1;
  };
  for (const decision of out.items) {
    const item = byId.get(decision.id);
    if (!item) continue;
    markSeen(state, item);
    countGate(item.sourceId, Boolean(decision.pass && decision.clusterRef));
    if (!decision.pass || !decision.clusterRef) {
      rejected += 1;
      if (rejectedSamples.length < 8) {
        rejectedSamples.push({
          title: truncate(item.title, 90),
          source: item.sourceName,
          reason: truncate(decision.rejectReason ?? "no reason given", 90),
        });
      }
      continue;
    }
    let cluster = refToCluster.get(decision.clusterRef) ?? state.clusters[decision.clusterRef];
    if (!cluster) {
      rejected += 1;
      continue;
    }
    // an item naming only proposal numbers its cluster does not name is a
    // different story, whatever the LLM decided: it becomes its own cluster,
    // flagged for review, rather than corrupting the one it was routed to
    const ids = itemProposals(item);
    const identity = new Set([...proposalIds(cluster.headline), ...linkProposals(cluster)]);
    if (proposalConflict(ids, identity)) {
      const key = `${decision.clusterRef}|${fmt(ids)}`;
      let q = quarantined.get(key);
      if (!q) {
        const qid = newId();
        q = {
          id: qid,
          slug: slugify(item.title, qid),
          headline: stripEmDashes(truncate(item.title, 140)),
          explainer: "",
          section: item.sectionHint ?? cluster.section,
          links: [],
          importance: 2,
          centrality: cluster.centrality ?? 3,
          keywords: [...ids].map((p) => p.toLowerCase()),
          needsReview: true,
          createdAt: now,
          updatedAt: now,
        };
        state.clusters[qid] = q;
        quarantined.set(key, q);
        clustersCreated += 1;
        guardNotes.push(
          `Proposal guard: "${truncate(item.title, 70)}" names ${fmt(ids)} but its assigned cluster "${truncate(cluster.headline, 60)}" is about ${fmt(identity)}; kept as its own story, flagged for review.`
        );
      }
      cluster = q;
    }
    // Numbering collisions: two DIFFERENT posts each formally titled with the
    // SAME proposal number (it happened: two threads both claimed EIP-8361,
    // one was later renumbered). The shared number makes the merge look right
    // to every other check, so this can only be flagged, not auto-split.
    const claim = primaryProposalClaim(item.title);
    if (claim) {
      const clash = cluster.links.find(
        (l) => primaryProposalClaim(l.title) === claim && normalizeUrl(l.url) !== normalizeUrl(item.url)
      );
      if (clash && !cluster.needsReview) {
        cluster.needsReview = true;
        guardNotes.push(
          `Proposal guard: two different posts both claim ${claim} ("${truncate(clash.title, 60)}" and "${truncate(item.title, 60)}"), a possible numbering collision; clustered together but flagged for review.`
        );
      }
    }
    state.items.unshift({
      id: item.id,
      url: item.url,
      title: item.title,
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      tier: item.tier,
      publishedAt: item.publishedAt,
      ingestedAt: now,
      excerpt: item.excerpt,
      clusterId: cluster.id,
    });
    if (!cluster.links.some((l) => normalizeUrl(l.url) === normalizeUrl(item.url))) {
      cluster.links.push({
        url: item.url,
        title: item.title,
        sourceId: item.sourceId,
        sourceName: item.sourceName,
        tier: item.tier,
        weight: item.weight,
        publishedAt: item.publishedAt,
        addedAt: now,
      });
    }
    cluster.updatedAt = now;
    touched.add(cluster.id);
  }

  // a new cluster no item ended up joining (every item rejected, or pulled out
  // by the guard) has no links, so nothing to render or rank: drop it
  for (const c of out.clusters) {
    if (!c.ref.startsWith("new:")) continue;
    const created = refToCluster.get(c.ref);
    if (created && state.clusters[created.id] && created.links.length === 0) {
      delete state.clusters[created.id];
      refToCluster.delete(c.ref);
      touched.delete(created.id);
      clustersCreated -= 1;
    }
  }

  const clusterIdByRef = new Map<string, string>();
  for (const [ref, c] of refToCluster) if (state.clusters[c.id]) clusterIdByRef.set(ref, c.id);

  return { rejected, rejectedSamples, clustersCreated, clustersUpdated, touched, clusterIdByRef, guardNotes };
}

/**
 * Freeze yesterday's best curation as a daily digest and cast it. Stories are
 * ranked by magnitude (score with decay factored out) so a big morning story
 * competes fairly with an evening one; capped at 10. Runs once per UTC day,
 * on the first pipeline run after midnight.
 */
async function makeDailyDigest(
  state: SiteState,
  cfg: SiteConfig
): Promise<{ date: string; count: number; cast: boolean; tweeted: boolean; notes: string[] } | null> {
  const yesterday = utcDay(new Date(Date.now() - 24 * 60 * 60000).toISOString());
  // a story belongs to the day it BROKE (earliest link), so each story lands
  // in exactly one daily page and a straggler link can't re-file it
  const broke = (c: Cluster) =>
    c.links.reduce((min, l) => (l.publishedAt < min ? l.publishedAt : min), c.links[0]?.publishedAt ?? c.createdAt);
  const dayClusters = liveClusters(state).filter((c) => utcDay(broke(c)) === yesterday);
  if (dayClusters.length === 0) return null;
  // magnitude = how big the story was that day, age stripped out entirely
  const mag = (c: Cluster) => magnitude(c, cfg.ranking);
  // same bar as Top Stories, falling back so a quiet day still gets a page
  const eligible = dayClusters.filter((c) => {
    const b = scoreBreakdown(c, cfg.ranking);
    return b.uniqueSources >= 2 || (b.importanceCapped ? 2 : c.importance) >= 3;
  });
  const top = [...(eligible.length > 0 ? eligible : dayClusters)].sort((a, b) => mag(b) - mag(a)).slice(0, 10);
  const digest: DailyDigest = {
    date: yesterday,
    takenAt: new Date().toISOString(),
    clusters: JSON.parse(JSON.stringify(top)) as Cluster[],
  };

  if (llmAvailable()) {
    try {
      digest.summary = joinSummaryLines(await dayInReview(yesterday, top)) || undefined;
    } catch {
      // the day page reads fine without its review bullets
    }
  }

  const url = `${cfg.bots.siteUrl}/day/${yesterday}`;
  const text = digestPostText(digest, cfg.bots.siteUrl);
  // failures never block the digest (the page must exist regardless), but
  // every skip or error is reported: three silently missing tweets taught us
  // that a swallowed reason is a debugging dead end
  let cast = false;
  const notes: string[] = [];
  try {
    // the nightly digest may cast into a configured channel (and only the
    // digest: story auto-posts stay on the home feed at a politer volume).
    // Channel casting usually requires channel membership to stick.
    const r = await castRaw(text, url, cfg.bots.farcaster.digestChannel || undefined);
    cast = !r.dryRun;
    if (r.dryRun) notes.push("cast skipped (dry-run or no credentials)");
    if (r.hash) digest.castHash = r.hash;
  } catch (err) {
    notes.push(`cast failed: ${truncate(err instanceof Error ? err.message : String(err), 200)}`);
  }
  try {
    // the anchor daily post on X; outside the story caps by design
    const t = await postTextToX(text);
    if (t.id) digest.tweetId = t.id;
    else notes.push(t.dryRun ? "tweet skipped (dry-run or no X credentials)" : "tweet sent but X returned no id");
  } catch (err) {
    notes.push(`tweet failed: ${truncate(err instanceof Error ? err.message : String(err), 200)}`);
  }
  await saveDailyDigest(digest);
  state.dailyDigestDates = [yesterday, ...(state.dailyDigestDates ?? []).filter((d) => d !== yesterday)];

  // the daily email edition IS this digest, so it sends the moment it exists
  try {
    const mailNote = await sendDailyEmail(state, digest);
    if (mailNote) notes.push(mailNote);
  } catch (err) {
    notes.push(`daily email failed: ${truncate(err instanceof Error ? err.message : String(err), 200)}`);
  }
  return { date: yesterday, count: top.length, cast, tweeted: Boolean(digest.tweetId), notes };
}

/**
 * The digest's social post text, shared by the nightly freeze and the admin
 * retry. Deliberately short and plain: the embedded link unfurls into a
 * preview card that already carries the page's title and summary, so cast
 * text repeating them read as saying everything twice.
 */
export function digestPostText(digest: Pick<DailyDigest, "date" | "clusters">, siteUrl: string): string {
  const dateLabel = new Date(`${digest.date}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
  });
  return `The top stories from ${dateLabel}:\n\n${siteUrl}/day/${digest.date}`;
}

/**
 * Split the links Farcaster surfaced into two piles.
 *
 * A link whose domain a whitelisted source already covers becomes a normal
 * candidate item attributed to THAT source, never to Farcaster: the site's
 * credibility rests on who published the article, not on who shared it. Those
 * items then face the usual gate, and dedupe drops the ones our feeds already
 * had, so what survives is genuinely news our polling missed.
 *
 * Every other domain is recorded as a source candidate for the admin to judge,
 * and is never published. Known hosts come from the links our accepted stories
 * already carry, so the map improves on its own as the archive grows.
 */
/**
 * Hosts a whitelisted source already covers, and which source that is. Seeded
 * from feed URLs (a source that has not published yet still owns its domain),
 * skipping platforms that host many unrelated publishers: a github.com link
 * is not "Geth releases". History is the better signal for outlets we reach
 * through a query feed, where the feed URL says nothing about where the
 * articles live, so it is layered on top.
 */
export function knownSourceHosts(state: SiteState): Map<string, { sourceId: string; sourceName: string }> {
  const sourceByHost = new Map<string, { sourceId: string; sourceName: string }>();
  const remember = (url: string, sourceId: string, sourceName: string) => {
    try {
      sourceByHost.set(normalizeHost(new URL(url).hostname), { sourceId, sourceName });
    } catch {}
  };
  const sharedHosts =
    /^(news\.google\.com|github\.com|paragraph\.com|paragraph\.xyz|mirror\.xyz|medium\.com|substack\.com|reddit\.com|old\.reddit\.com)$/i;
  for (const f of effectiveFeeds(state)) {
    if (f.type === "farcaster") continue;
    try {
      const host = normalizeHost(new URL(f.url).hostname);
      if (!sharedHosts.test(host)) sourceByHost.set(host, { sourceId: f.id, sourceName: f.name });
    } catch {}
  }
  for (const c of Object.values(state.clusters)) {
    for (const l of c.links) remember(l.url, l.sourceId, l.sourceName);
  }
  for (const i of state.items) remember(i.url, i.sourceId, i.sourceName);
  return sourceByHost;
}

function routeCastLinks(
  state: SiteState,
  results: FeedFetchResult[],
  cfg: SiteConfig
): { items: CandidateItem[]; links: number; newHosts: string[] } {
  const links = results.flatMap((r) => r.castLinks ?? []);
  const newHosts: string[] = [];
  if (links.length === 0) return { items: [], links: 0, newHosts };

  const feedById = new Map(effectiveFeeds(state).map((f) => [f.id, f]));
  const sourceByHost = knownSourceHosts(state);

  const now = new Date().toISOString();
  const candidates = (state.sourceCandidates ??= {});
  const items: CandidateItem[] = [];
  const maxAgeHours = cfg.ingest.maxItemAgeHours;

  for (const link of links) {
    const known = sourceByHost.get(link.host);
    if (known) {
      const feed = feedById.get(known.sourceId);
      // only worth ingesting while it is still news, and only from a source
      // that is still on the whitelist
      if (!feed || hoursAgo(link.at) > maxAgeHours) continue;
      items.push({
        url: link.url,
        title: link.text || link.url,
        publishedAt: link.at,
        sourceId: feed.id,
        sourceName: feed.name,
        tier: feed.tier,
        weight: feed.weight,
        sectionHint: feed.sectionHint,
        viaFarcaster: true,
      });
      continue;
    }
    if (!candidates[link.host]) newHosts.push(link.host);
    const entry = (candidates[link.host] ??= {
      host: link.host,
      casts: 0,
      engagement: 0,
      topReach: 0,
      firstSeen: now,
      lastSeen: now,
      examples: [],
    });
    if (entry.examples.some((e) => e.url === link.url)) continue; // same link again
    entry.casts += 1;
    entry.engagement += link.engagement;
    entry.topReach = Math.max(entry.topReach, link.reach);
    entry.lastSeen = now;
    entry.examples = [{ url: link.url, author: link.author, text: link.text, at: link.at }, ...entry.examples].slice(0, 5);
  }
  return { items, links: links.length, newHosts };
}

/**
 * House prediction-market story: an exceptional 24h swing in a curated
 * Polymarket EVENT market writes a house-voiced factual story. Odds on
 * topical events are information (they often move with or ahead of the
 * news), but only a deterministic bar earns them a story: fixed points
 * threshold, liquidity floor so one trader repositioning a thin book can't
 * fire it, per-market cooldown, and an admin-killed story stays killed.
 * The 24h change comes from the API when it provides one, otherwise from a
 * rolling baseline kept in state. An unresolvable slug is reported in the run
 * notes rather than failing the run, since config slugs rot when markets close.
 */
async function maybeMarketStories(state: SiteState, cfg: SiteConfig): Promise<{ created: number; notes: string[] }> {
  const pm = cfg.polymarket;
  const out = { created: 0, notes: [] as string[] };
  if (!pm || pm.movePointsThreshold <= 0) return out;
  // config markets minus admin-disabled, plus admin-added (see the admin panel)
  const markets = effectiveMarkets(state);
  if (markets.length === 0) return out;
  const now = new Date().toISOString();
  const moves = (state.marketMoves ??= {});
  const baselines = (state.marketBaselines ??= {});
  for (const market of markets) {
    const quote = await polymarketQuote(market.slug);
    if (!quote) {
      out.notes.push(`Polymarket: could not resolve "${market.slug}" (check the slug in config).`);
      continue;
    }
    if (quote.closed) continue;
    const base = baselines[market.slug];
    // the resolved event URL refreshes every run; the probability baseline only daily
    baselines[market.slug] =
      !base || hoursAgo(base.at) >= 24
        ? { prob: quote.prob, at: now, url: quote.url }
        : { ...base, url: quote.url };
    if (quote.liquidity < pm.minLiquidity) continue;
    let change = quote.change24h;
    if (change === undefined) {
      // baseline younger than most of a day would understate real swings
      if (!base || hoursAgo(base.at) < 18) continue;
      change = quote.prob - base.prob;
    }
    const points = change * 100;
    if (Math.abs(points) < pm.movePointsThreshold) continue;
    const last = moves[market.slug];
    if (last && hoursAgo(last.at) < pm.cooldownHours) continue; // one story per episode
    if (last && state.clusters[last.clusterId]?.killed) continue; // admin-killed stays killed
    const pct = Math.round(quote.prob * 100);
    const delta = Math.round(Math.abs(points));
    const dir = points < 0 ? "down" : "up";
    const headline = truncate(`Polymarket now puts ${market.label} at ${pct}%, ${dir} ${delta} points in a day`, 140);
    const id = newId();
    state.clusters[id] = {
      id,
      slug: slugify(headline, id),
      headline,
      explainer: `${siteIdentity().siteName} covers prediction markets only on exceptional swings, and a ${delta}-point move in a day clears that bar. Factual coverage of what moved the odds collects here.`,
      section: market.section ?? loadSiteConfig().sections[0]?.id ?? "general",
      links: [
        {
          url: quote.url,
          title: truncate(quote.question, 300),
          sourceId: "polymarket",
          sourceName: "Polymarket",
          tier: 2,
          weight: 1,
          publishedAt: now,
          addedAt: now,
        },
      ],
      importance: 3,
      centrality: 4,
      keywords: [market.label, "polymarket", "prediction market", "odds"],
      createdAt: now,
      updatedAt: now,
    };
    moves[market.slug] = { clusterId: id, prob: quote.prob, at: now };
    out.created += 1;
    out.notes.push(`Polymarket swing: "${market.label}" ${dir} ${delta} points, house story created.`);
  }
  return out;
}

function prune(state: SiteState): void {
  const cfg = loadSiteConfig().ingest;
  state.items = state.items
    .filter((i) => hoursAgo(i.ingestedAt) <= cfg.riverRetentionDays * 24)
    .slice(0, cfg.maxRiverItems);
  for (const [hash, firstSeen] of Object.entries(state.seen)) {
    if (hoursAgo(firstSeen) > cfg.seenHashRetentionDays * 24) delete state.seen[hash];
  }
  // source candidates expire unless dismissed, so the queue reflects what
  // Farcaster is pointing at now rather than everything it ever pointed at
  const fcRetention = loadSiteConfig().farcaster?.candidateRetentionDays ?? 45;
  for (const [host, cand] of Object.entries(state.sourceCandidates ?? {})) {
    if (!cand.dismissed && hoursAgo(cand.lastSeen) > fcRetention * 24) delete state.sourceCandidates![host];
  }
  // gate counters outlive the leaderboard window by a few days, no longer
  const oldestDay = utcDay(new Date(Date.now() - SOURCE_STATS_RETENTION_DAYS * 24 * 60 * 60000).toISOString());
  for (const [sourceId, days] of Object.entries(state.sourceStats ?? {})) {
    for (const day of Object.keys(days)) if (day < oldestDay) delete days[day];
    if (Object.keys(days).length === 0) delete state.sourceStats![sourceId];
  }
  // submissions expire after 14 days whether reviewed or not: the queue must
  // never turn into a chore
  if (state.submissions) {
    state.submissions = state.submissions.filter((s) => hoursAgo(s.at) <= 14 * 24);
  }
  // market baselines and cooldowns for slugs no longer configured are dead
  // weight; disabled markets keep theirs so re-enabling resumes cleanly
  const pmSlugs = new Set([
    ...(loadSiteConfig().polymarket?.markets ?? []).map((m) => m.slug),
    ...(state.marketOverrides?.custom ?? []).map((m) => m.slug),
  ]);
  for (const slug of Object.keys(state.marketBaselines ?? {})) {
    if (!pmSlugs.has(slug)) delete state.marketBaselines![slug];
  }
  for (const slug of Object.keys(state.marketMoves ?? {})) {
    if (!pmSlugs.has(slug)) delete state.marketMoves![slug];
  }
}

/**
 * Re-run the current editorial rules over ONE cluster's existing links,
 * refreshing headline/explainer/section/importance in place. The cluster id
 * is preserved, and permalinks keep resolving (lookup falls back to the id
 * suffix), so history and shared links survive.
 */
export async function reeditCluster(state: SiteState, cluster: Cluster): Promise<string> {
  if (!llmAvailable()) return "LLM not configured. Cluster left unchanged.";
  // links don't retain excerpts, but the river does (30 days): recover them
  // so re-edits work from the same material as the original ingestion
  const excerptByUrl = new Map(
    state.items.filter((i) => i.excerpt).map((i) => [normalizeUrl(i.url), i.excerpt as string])
  );
  const items = cluster.links.map((l, i) => ({
    id: `l${i}`,
    url: l.url,
    title: l.title,
    excerpt: excerptByUrl.get(normalizeUrl(l.url)),
    publishedAt: l.publishedAt,
    sourceId: l.sourceId,
    sourceName: l.sourceName,
    tier: l.tier,
    weight: l.weight,
  })) as Array<CandidateItem & { id: string }>;
  // forum items often entered the river title-only; fetch their post bodies now
  await enrichNewItems(items, effectiveFeeds(state), loadSiteConfig().ingest.feedTimeoutMs);
  const out = await classifyAndCluster(items, []);
  const counts = new Map<string, number>();
  for (const d of out.items) {
    if (d.pass && d.clusterRef) counts.set(d.clusterRef, (counts.get(d.clusterRef) ?? 0) + 1);
  }
  const topRef = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const entry = out.clusters.find((c) => c.ref === topRef) ?? out.clusters[0];
  if (!entry) return "Editor returned nothing usable. Cluster left unchanged.";
  const before = cluster.headline;
  cluster.headline = stripEmDashes(truncate(entry.headline, 140));
  cluster.explainer = cleanExplainer(entry.explainer);
  cluster.section = entry.section;
  cluster.importance = Math.max(1, Math.min(5, Math.round(entry.importance)));
  cluster.centrality = Math.max(1, Math.min(5, Math.round(entry.centrality ?? 3)));
  cluster.keywords = entry.keywords;
  if (entry.opinion !== undefined) cluster.opinion = entry.opinion;
  cluster.slug = slugify(cluster.headline, cluster.id);
  cluster.needsReview = false;
  cluster.updatedAt = new Date().toISOString();
  cluster.editHistory = [
    { at: new Date().toISOString(), kind: "reedit" as const, before, after: cluster.headline },
    ...(cluster.editHistory ?? []),
  ].slice(0, 5);
  return before === cluster.headline
    ? "Re-edited: headline unchanged (explainer/section/scores may still have updated)."
    : `Re-edited: headline is now “${cluster.headline}”.`;
}

export async function takeSnapshot(state: SiteState): Promise<string> {
  const cfg = loadSiteConfig();
  const id = snapshotId();
  // a snapshot is the whole front page as it was, summary included, but only
  // when the summary was actually showing (same freshness bar as the page)
  const summaryFresh =
    state.frontSummary?.text && hoursAgo(state.frontSummary.at) <= FRONT_SUMMARY_MAX_AGE_HOURS;
  await saveSnapshot({
    id,
    takenAt: new Date().toISOString(),
    clusters: rankClusters(liveClusters(state), cfg.ranking),
    ...(summaryFresh ? { frontSummary: state.frontSummary!.text } : {}),
  });
  if (!state.snapshots.includes(id)) state.snapshots.push(id);
  return id;
}

async function maybePostBots(state: SiteState, report: RunReport): Promise<boolean> {
  const cfg = loadSiteConfig();
  const now = new Date();
  let changed = false;

  // Farcaster: the automated channel. New top-ranked stories, bounded per day.
  const top = topStories(state, cfg.ranking, now);
  for (const cluster of top.slice(0, cfg.bots.farcaster.topN)) {
    if (cluster.posted?.farcaster) continue;
    if (score(cluster, cfg.ranking, now) < cfg.bots.farcaster.minScore) continue;
    if (farcasterPostedToday(state) >= cfg.bots.farcaster.maxPerDay) {
      report.notes.push("Farcaster daily bound reached; skipping remaining posts.");
      break;
    }
    try {
      const { dryRun, hash } = await postToFarcaster(state, cluster, cfg.bots);
      cluster.posted = { ...cluster.posted, farcaster: now.toISOString(), ...(hash ? { farcasterHash: hash } : {}) };
      report.posted.push(`farcaster:${cluster.id}${dryRun ? " (dry-run)" : ""}`);
      changed = true;
    } catch (err) {
      report.notes.push(`Farcaster post failed for ${cluster.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // X: strictly max one automated post per day, monthly hard cap inside postToX.
  const candidate = top.find((c) => !c.posted?.x && !state.xPosts.some((p) => p.clusterId === c.id));
  if (
    cfg.bots.x.maxAutoPerDay > 0 &&
    candidate &&
    !xAutoPostedToday(state) &&
    score(candidate, cfg.ranking, now) >= cfg.bots.x.minScore
  ) {
    try {
      const { dryRun } = await postToX(state, candidate, cfg.bots, { manual: false });
      candidate.posted = { ...candidate.posted, x: now.toISOString() };
      report.posted.push(`x:${candidate.id}${dryRun ? " (dry-run)" : ""}`);
      changed = true;
    } catch (err) {
      if (err instanceof XCapError) report.notes.push(`X cap: ${err.message}`);
      else report.notes.push(`X post failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  report.notes.push(`X posts this month: ${xMonthlyCount(state)}/${cfg.bots.x.maxPerMonth}`);
  return changed;
}

/**
 * The whole product: fetch → dedupe → LLM edit → merge → snapshot → bots.
 * Idempotent: a re-run of the same inputs is a no-op (dedupe by hash), and
 * state is only written after a fully successful merge.
 */
export async function runPipeline(): Promise<RunReport> {
  const startedAt = Date.now();
  const cfg = loadSiteConfig();
  // fresh: mutating and saving a stale fallback copy would roll the site back
  const state = await loadState({ fresh: true });
  const feeds = effectiveFeeds(state);

  const report: RunReport = {
    fetchedFeeds: feeds.length,
    feedErrors: [],
    newItems: 0,
    usedLlm: false,
    rejected: 0,
    clustersCreated: 0,
    clustersUpdated: 0,
    posted: [],
    notes: [],
  };

  const results = await fetchAllFeeds(feeds, cfg.ingest, cfg.farcaster);
  report.feedErrors = results.filter((r) => r.error).map((r) => ({ feedId: r.feed.id, error: r.error! }));

  const fc = routeCastLinks(state, results, cfg);
  // always logged when a discovery feed is configured, so a silent run is
  // distinguishable from a broken one in the run log
  if (feeds.some((f) => f.type === "farcaster")) {
    const total = Object.values(state.sourceCandidates ?? {}).filter((c) => !c.dismissed).length;
    report.notes.push(
      `Farcaster: ${fc.links} link(s) read, ${fc.items.length} from known sources, ${fc.newHosts.length} new candidate domain(s)${fc.newHosts.length > 0 ? ` (${fc.newHosts.slice(0, 5).join(", ")})` : ""}, ${total} awaiting review.`
    );
  }

  // Candidates the admin has not judged yet get one editor read each (what the
  // domain publishes, likely sections), written once and kept until expiry.
  // Best-effort: a failed call is a run-log note, never a failed run.
  if (llmAvailable()) {
    const covered = knownSourceHosts(state);
    const unread = Object.values(state.sourceCandidates ?? {})
      .filter((c) => !c.dismissed && !c.assessment && !covered.has(c.host))
      .slice(0, 12);
    if (unread.length > 0) {
      try {
        const reads = await assessSourceCandidates(unread);
        const at = new Date().toISOString();
        for (const c of unread) {
          const r = reads[c.host];
          if (r) c.assessment = { why: r.why, sections: r.sections, at };
        }
      } catch (err) {
        report.notes.push(`Candidate assessment failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  const candidates = [...results.flatMap((r) => r.items), ...fc.items];
  let newItems = selectNewItems(state, candidates);

  // Listing feeds are scraped pages with no publish dates: their first crawl
  // only baselines what already exists (marked seen, not ingested), so only
  // posts appearing on later crawls become news, timestamped by discovery.
  const firstCrawlListings = new Set(
    feeds.filter((f) => f.type === "listing" && !state.feedHealth[f.id]).map((f) => f.id)
  );
  if (firstCrawlListings.size > 0) {
    const baselined = newItems.filter((i) => firstCrawlListings.has(i.sourceId));
    for (const i of baselined) markSeen(state, i);
    if (baselined.length > 0) report.notes.push(`Baselined ${baselined.length} existing posts from new listing feeds.`);
    newItems = newItems.filter((i) => !firstCrawlListings.has(i.sourceId));
  }

  let rejectedSamples: Array<{ title: string; source: string; reason: string }> = [];
  report.newItems = newItems.length;
  updateFeedHealth(state, results, new Set(newItems.map((i) => i.sourceId)));

  let contentChanged = false;
  if (newItems.length > 0) {
    await enrichNewItems(newItems, feeds, cfg.ingest.feedTimeoutMs);
    let out: EditorOutput;
    if (llmAvailable()) {
      try {
        // the front summary describes the FRONT PAGE, so the editor is shown
        // the currently top-ranked stories, not just what happened to arrive.
        // At weekends the page leads with the week, so it gets that list too.
        const weekend = weekendMode(cfg.ranking, new Date(), state.weekendSchedule);
        out = await classifyAndCluster(newItems, digestClusters(state, cfg.ingest), "cluster", {
          frontPageTop: topStories(state, cfg.ranking).slice(0, 6),
          weekTop: weekend ? weekInReview(state, cfg.ranking, new Set()) : [],
          weekendMode: weekend,
        });
        report.usedLlm = true;
      } catch (err) {
        report.notes.push(`LLM failed, using fallback: ${err instanceof Error ? err.message : err}`);
        out = heuristicFallback(newItems);
      }
    } else {
      report.notes.push("No LLM key configured; heuristic fallback (tier-1 only, needs review).");
      out = heuristicFallback(newItems);
    }
    const applied = applyEditorOutput(state, newItems, out);
    report.rejected = applied.rejected;
    rejectedSamples = applied.rejectedSamples;
    report.clustersCreated = applied.clustersCreated;
    report.clustersUpdated = applied.clustersUpdated;
    report.notes.push(...applied.guardNotes);
    contentChanged = applied.touched.size > 0 || applied.clustersCreated > 0;
    if (!report.usedLlm && contentChanged) {
      for (const id of applied.touched) state.clusters[id].needsReview = true;
    }
    // the editor writes the front-page summary alongside its clustering pass,
    // so it costs no extra call; only a real LLM run may replace the last one.
    // Runs after the merge so a bullet's story ref resolves to a cluster that
    // actually exists (new:N mapped through what the merge created).
    const resolveRef = (ref: string): string | undefined => {
      const id = applied.clusterIdByRef.get(ref) ?? ref;
      const c = state.clusters[id];
      return c && !c.killed && /^[a-z0-9]+$/.test(id) ? id : undefined;
    };
    const summaryText = report.usedLlm && out.frontSummary ? joinSummaryLines(out.frontSummary, resolveRef) : "";
    if (summaryText) {
      state.frontSummary = {
        text: carryForwardSummary(summaryText, state.frontSummary?.text),
        at: new Date().toISOString(),
      };
    }
  }

  try {
    const swings = await maybeMarketStories(state, cfg);
    if (swings.created > 0) contentChanged = true;
    report.notes.push(...swings.notes);
  } catch (err) {
    report.notes.push(`Polymarket check failed: ${err instanceof Error ? err.message : err}`);
  }

  prune(state);

  const today = utcDay(new Date().toISOString());
  if ((state.lastDailyDigest ?? "") !== today) {
    try {
      const made = await makeDailyDigest(state, cfg);
      if (made) {
        report.notes.push(
          [
            `Daily digest ${made.date}: ${made.count} stories`,
            made.cast ? "cast posted" : null,
            made.tweeted ? "tweeted" : null,
            ...made.notes,
          ]
            .filter(Boolean)
            .join(", ")
        );
      }
    } catch (err) {
      report.notes.push(`Daily digest failed: ${err instanceof Error ? err.message : err}`);
    }
    state.lastDailyDigest = today;
  }

  // Saturday-morning weekly email: the prior Saturday to Friday's top stories,
  // assembled from the frozen daily digests, once per Saturday
  const nowUtc = new Date();
  if (nowUtc.getUTCDay() === 6 && nowUtc.getUTCHours() >= WEEKLY_SEND_HOUR_UTC && (state.lastWeeklyDigest ?? "") !== today) {
    try {
      const note = await sendWeeklyEmail(state, cfg);
      if (note) report.notes.push(note);
    } catch (err) {
      report.notes.push(`Weekly email failed: ${err instanceof Error ? err.message : err}`);
    }
    // the weekly cast rides the same once-per-Saturday trigger as the email
    try {
      const wc = await buildWeeklyCast(state, cfg);
      if (wc) {
        const r = await castRaw(wc.text, wc.url, cfg.bots.farcaster.digestChannel || undefined);
        report.notes.push(r.dryRun ? "Weekly cast skipped (dry-run or no credentials)." : "Weekly cast posted.");
      } else {
        report.notes.push("Weekly cast skipped (fewer than three stories this week).");
      }
    } catch (err) {
      report.notes.push(`Weekly cast failed: ${err instanceof Error ? err.message : err}`);
    }
    state.lastWeeklyDigest = today;
  }

  if (contentChanged) {
    report.snapshot = await takeSnapshot(state);
  }

  await maybePostBots(state, report);

  state.runLog = [
    {
      at: new Date().toISOString(),
      ms: Date.now() - startedAt,
      newItems: report.newItems,
      rejected: report.rejected,
      ...(rejectedSamples.length > 0 ? { rejectedSamples } : {}),
      clustersCreated: report.clustersCreated,
      clustersUpdated: report.clustersUpdated,
      usedLlm: report.usedLlm,
      feedErrors: report.feedErrors,
      posted: report.posted,
      notes: report.notes,
      ...(report.snapshot ? { snapshot: report.snapshot } : {}),
    },
    ...(state.runLog ?? []),
  ].slice(0, 50);

  // State is saved every run (feed-health timestamps change even on no-news
  // runs, which is how feed rot stays visible). The expensive artifacts
  // (LLM calls, snapshots, bot posts) only happen when content changed.
  await saveState(state);

  return report;
}
