import { effectiveFeeds, effectiveMarkets, loadSiteConfig, siteUrl } from "./config";
import { buildWeeklyCast, monthLabel, monthlyTop, poolFromDailies, rankPool, sendDailyEmail, sendMonthlyEmail, sendWeeklyEmail, subjectRangeLabel, weeklyTop, WEEKLY_SEND_HOUR_UTC, yearlyTop } from "./digest";
import { sendAdminEmail } from "./mail";
import { enrichNewItems, extractChapters, extractDescriptionLinks, fetchAllFeeds, fetchMediaFeeds, fetchVideoManifest, fetchYoutubeDetails, isMediaFeed, isYoutubeShort, normalizeHost, updateFeedHealth, youtubeVideoId, type CastLink, type FeedFetchResult, type MediaCandidate } from "./feeds";
import { assessSourceCandidates, classifyAndCluster, compressTweetLines, dayInReview, gateMediaItems, heuristicFallback, llmAvailable, refreshFrontSummary, summarizeRelease, type EditorOutput, type SummaryBullet, matchChaptersToStories } from "./llm";
import { liveClusters, magnitude, rankClusters, rankMedia, score, scoreBreakdown, sectionStories, topStories, weekInReview, weekendMode } from "./rank";
import type { SectionId, SiteConfig } from "./types";
import { polymarketQuote } from "./polymarket";
import { siteIdentity } from "./site";
import { castRaw, postToFarcaster, farcasterPostedToday } from "./social/farcaster";
import { postTextToX, postToX, xAutoPostedToday, xMonthlyCount, XCapError } from "./social/x";
import { loadDailyDigest, loadState, saveDailyDigest, saveMonthlyDigest, saveSnapshot, saveState, saveWeeklyDigest, saveYearlyDigest } from "./state";
import { FRONT_SUMMARY_MAX_AGE_HOURS } from "./types";
import type { CandidateItem, Cluster, DailyDigest, MediaItem, MonthlyDigest, SiteState, WeeklyDigest, YearlyDigest } from "./types";
import { ogTruncate } from "./og";
import { bestMatchIndex, hoursAgo, newId, normalizeUrl, parseSummaryLines, primaryProposalClaim, proposalConflict, proposalIds, sha256, slugify, snapshotId, stripEmDashes, stripHtml, truncate, utcDay } from "./util";

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
  // "recently active" means recent COVERAGE: when the newest link arrived.
  // updatedAt also moves on admin actions and other passes, and any phantom
  // bump here walks a weeks-old story into the editor's context and from
  // there into the front summary as if it were news.
  const activity = new Map(
    liveClusters(state).map((c) => [
      c.id,
      c.links.reduce((max, l) => {
        const at = l.addedAt || l.publishedAt;
        return at > max ? at : max;
      }, c.createdAt),
    ])
  );
  return liveClusters(state)
    .filter((c) => hoursAgo(activity.get(c.id)!) <= cfg.digestClusterDays * 24)
    .sort((a, b) => activity.get(b.id)!.localeCompare(activity.get(a.id)!))
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
 * Content hash of a frozen edition, stored on the digest at freeze time.
 * Post-freeze bookkeeping (tweetId, castHash) stays outside the hash, so the
 * stored value keeps verifying against the published blob's other fields
 * (JSON round-trips preserve key order). In-progress previews are never
 * hashed. Groundwork for collectible editions: this is the hash an edition
 * NFT or onchain attestation would carry as proof of the period's record.
 */
function digestContentHash(digest: object): string {
  const { castHash, tweetId, contentHash, inProgress, ...core } = digest as Record<string, unknown>;
  void castHash; void tweetId; void contentHash; void inProgress;
  return sha256(JSON.stringify(core));
}

/**
 * Release-feed items arrive titled "v1.47.0-rc.0 released", which tells the
 * reader nothing. Before the editor sees them, a stronger model reads the
 * release notes and rewrites title and excerpt around the release's actual
 * themes. A failure leaves the original title standing, and the notes never
 * persist past this step.
 */
async function enrichReleaseItems(items: CandidateItem[], report: RunReport): Promise<void> {
  const targets = items.filter((i) => i.releaseNotes).slice(0, 4);
  if (llmAvailable()) {
    for (const item of targets) {
      try {
        const out = await summarizeRelease({ source: item.sourceName, title: item.title, notes: item.releaseNotes! });
        if (out.headline.trim() && out.explainer.trim()) {
          item.title = truncate(stripHtml(out.headline), 300);
          item.excerpt = truncate(stripHtml(out.explainer), 500);
        }
      } catch (err) {
        report.notes.push(`release summary failed for ${item.sourceName}: ${truncate(err instanceof Error ? err.message : String(err), 160)}`);
      }
    }
  }
  for (const item of items) delete item.releaseNotes;
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
      return `[${l.section}${id ? `@${id}` : ""}] ${ogTruncate(l.text, 160)}`;
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

/**
 * The editor is told to give every section a line, and carryForwardSummary
 * keeps old lines alive, but a section no summary has EVER covered (a fresh
 * site's first run, a newly added section, an editor that ignored the
 * instruction) still renders its box as a "nothing notable" placeholder while
 * stories sit directly beneath it. Last resort: front the section's
 * top-ranked story headline. Only fills boxes that would otherwise be empty;
 * an editor-written line is never replaced.
 */
function backfillSummarySections(text: string, state: SiteState, cfg: SiteConfig): string {
  const covered = new Set<string | null>(parseSummaryLines(text).map((l) => l.section));
  const added = cfg.sections
    .filter((s) => !covered.has(s.id))
    .map((s) => sectionStories(state, s.id, cfg.ranking)[0])
    .filter((c): c is Cluster => Boolean(c))
    .map((c) => `[${c.section}@${c.id}] ${truncate(c.headline, 160)}`);
  return added.length > 0 ? [text, ...added].filter(Boolean).join("\n") : text;
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
        ...(c.alsoIn && c.alsoIn !== c.section ? { alsoIn: c.alsoIn } : {}),
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
      if (c.alsoIn && c.alsoIn !== c.section) existing.alsoIn = c.alsoIn;
      else delete existing.alsoIn;
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
        ...(item.undated ? { undated: true } : {}),
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

/** Insert a key into a newest-first date list, deduped and re-sorted (the
 * in-progress editions can add keys newer than a later freeze's, so a plain
 * prepend would disorder the list). */
function rememberDate(list: string[] | undefined, v: string): string[] {
  return [...new Set([v, ...(list ?? [])])].sort().reverse();
}

/**
 * The day's story lists, shared by the nightly freeze and the in-progress
 * preview. `top` is the day page's list: stories that BROKE that day
 * (earliest link, so each story files to exactly one page), ranked by
 * magnitude (score with decay factored out, so a big morning story competes
 * fairly with an evening one), same eligibility bar as Top Stories with a
 * fallback so a quiet day still gets a page; capped at 10. `reviewPool` is
 * every story ACTIVE that day (any link published then), for the review
 * bullets and the also-in-the-news list.
 */
function dayTopClusters(state: SiteState, cfg: SiteConfig, date: string): { top: Cluster[]; reviewPool: Cluster[] } {
  const broke = (c: Cluster) =>
    c.links.reduce((min, l) => (l.publishedAt < min ? l.publishedAt : min), c.links[0]?.publishedAt ?? c.createdAt);
  const mag = (c: Cluster) => magnitude(c, cfg.ranking);
  const dayClusters = liveClusters(state).filter((c) => utcDay(broke(c)) === date);
  const eligible = dayClusters.filter((c) => {
    const b = scoreBreakdown(c, cfg.ranking);
    return b.uniqueSources >= 2 || (b.importanceCapped ? 2 : c.importance) >= 3;
  });
  const top = [...(eligible.length > 0 ? eligible : dayClusters)].sort((a, b) => mag(b) - mag(a)).slice(0, 10);
  const active = liveClusters(state).filter((c) => c.links.some((l) => !l.undated && utcDay(l.publishedAt) === date));
  const reviewPool = [...active].sort((a, b) => mag(b) - mag(a)).slice(0, 12);
  return { top, reviewPool };
}

/**
 * Freeze yesterday's best curation as a daily digest and cast it. Runs once
 * per UTC day, on the first pipeline run after midnight.
 */
async function makeDailyDigest(
  state: SiteState,
  cfg: SiteConfig
): Promise<{ date: string; count: number; cast: boolean; tweeted: boolean; notes: string[] } | null> {
  const yesterday = utcDay(new Date(Date.now() - 24 * 60 * 60000).toISOString());
  const { top, reviewPool } = dayTopClusters(state, cfg, yesterday);
  if (top.length === 0) return null;
  const digest: DailyDigest = {
    date: yesterday,
    takenAt: new Date().toISOString(),
    clusters: JSON.parse(JSON.stringify(top)) as Cluster[],
  };

  {
    let bullets: SummaryBullet[] = [];
    if (llmAvailable()) {
      // the day page reads fine without the model's review bullets
      bullets = await dayInReview(yesterday, reviewPool).catch(() => []);
    }
    // "A quiet day here." may only appear for a section that truly had no
    // active stories: any section the model skipped (or the model failing
    // entirely) falls back to its biggest active story as its bullet
    const covered = new Set(bullets.map((b) => b.section));
    for (const sec of cfg.sections.map((s) => s.id)) {
      if (covered.has(sec)) continue;
      const biggest = reviewPool.find((c) => c.section === sec || c.alsoIn === sec);
      if (biggest) bullets.push({ section: sec, ref: biggest.id, text: biggest.headline });
    }
    digest.summary = joinSummaryLines(bullets) || undefined;
    // the day's other news: active stories filed to earlier days, frozen as
    // plain links so a thin broke-day list still reads like the day
    const topIds = new Set(top.map((c) => c.id));
    const also = reviewPool
      .filter((c) => !topIds.has(c.id))
      .slice(0, 8)
      .map((c) => ({ headline: c.headline, slug: c.slug, ...(c.section !== "general" ? { section: c.section } : {}) }));
    if (also.length > 0) digest.alsoActive = also;
  }

  // the day's top podcasts freeze into the digest, playable on the day page;
  // days with no fresh episode borrow the shelf's current top so the section
  // (and the tweet's Podcast line) never goes empty
  const dayEps = rankMedia(
    (state.mediaItems ?? []).filter((m) => !m.hidden && utcDay(m.publishedAt) === yesterday),
    state,
    cfg.ranking
  ).slice(0, 4);
  const fallbackEps = dayEps.length > 0 ? dayEps : rankMedia((state.mediaItems ?? []).filter((m) => !m.hidden), state, cfg.ranking).slice(0, 1);
  if (fallbackEps.length > 0) digest.episodes = JSON.parse(JSON.stringify(fallbackEps)) as MediaItem[];

  const url = `${cfg.bots.siteUrl}/day/${yesterday}`;
  // the cast carries the same snapshot text as the X thread's first tweet,
  // with the day page as the embed standing in for the reply's link
  const text = await threadFirstTweet(`${siteIdentity().siteName} - ${tweetDate(yesterday)}`, digest.clusters, state, cfg, 36, digest.episodes?.[0]);
  // failures never block the digest (the page must exist regardless), but
  // every skip or error is reported: three silently missing tweets taught us
  // that a swallowed reason is a debugging dead end
  let cast = false;
  const notes: string[] = [];
  try {
    // the nightly digest may cast into a configured channel (and only the
    // digest: story auto-posts stay on the home feed at a politer volume).
    // Channel casting usually requires channel membership to stick.
    // the page embed is the cast's "full day in review" link, so the cast
    // only appends the email ask beneath the snapshot
    const r = await castRaw(`${text}\n\n${subscribeLines(cfg)}`, url, cfg.bots.farcaster.digestChannel || undefined);
    cast = !r.dryRun;
    if (r.dryRun) notes.push("cast skipped (dry-run or no credentials)");
    if (r.hash) digest.castHash = r.hash;
  } catch (err) {
    notes.push(`cast failed: ${truncate(err instanceof Error ? err.message : String(err), 200)}`);
  }
  digest.contentHash = digestContentHash(digest);
  // the X side is the day THREAD, posted (and retried) by its own pipeline
  // step once the digest exists, so a failed post never blocks the freeze
  await saveDailyDigest(digest);
  state.dailyDigestDates = rememberDate(state.dailyDigestDates, yesterday);

  // the daily email edition IS this digest, so it sends the moment it exists
  try {
    const mailNote = await sendDailyEmail(state, digest);
    if (mailNote) notes.push(mailNote);
  } catch (err) {
    notes.push(`daily email failed: ${truncate(err instanceof Error ? err.message : String(err), 200)}`);
  }
  return { date: yesterday, count: top.length, cast, tweeted: Boolean(digest.tweetId), notes };
}

/** The email ask shared by tweet 2 and the digest casts. */
const subscribeLines = (cfg: SiteConfig): string => `Get regular summary emails:\n${cfg.bots.siteUrl}/subscribe`;

/**
 * Tweet 2 of a digest thread: the archive link, then the email ask. No
 * follow line by decision: not asking is part of the digests' voice.
 */
function threadSecondTweet(period: "day" | "week" | "month", pageUrl: string, cfg: SiteConfig): string {
  return `Full ${period} in review:\n${pageUrl}\n\n${subscribeLines(cfg)}`;
}

/** "August 26, 2026" for the daily tweet heading. */
function tweetDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Tweet 1 of a digest thread: the heading, then one labeled block per
 * section and the top podcast, each label on its own line with a blank line
 * between blocks. Never empty: a section missing from the digest pool falls
 * back to its biggest live story, and the podcast line falls back from the
 * window to the shelf's overall top. Lines are compressed into COMPLETE
 * phrases by the editor model (never an ellipsis); without an LLM they trim
 * at word boundaries, and budgets shrink until the tweet fits 280.
 */
async function threadFirstTweet(
  heading: string,
  pool: Cluster[],
  state: SiteState,
  cfg: SiteConfig,
  podcastWindowHours: number,
  preferredEpisode?: MediaItem
): Promise<string> {
  const pick = (sec: SectionId): Cluster | undefined =>
    pool.find((c) => c.section === sec || c.alsoIn === sec) ?? sectionStories(state, sec, cfg.ranking)[0];
  const media = rankMedia((state.mediaItems ?? []).filter((m) => !m.hidden), state, cfg.ranking);
  const inWindow = media.filter((m) => Date.now() - Date.parse(m.publishedAt) <= podcastWindowHours * 3600000);
  const ep = preferredEpisode ?? inWindow[0] ?? media[0];

  const blocks: Array<{ label: string; text: string; suffix: string; max: number }> = [];
  for (const s of cfg.sections) {
    const c = pick(s.id);
    if (c) blocks.push({ label: `${s.title}:`, text: c.headline, suffix: "", max: 52 });
  }
  if (ep) {
    const suffix = ` (${ep.sourceName})`;
    blocks.push({ label: "Podcast:", text: ep.displayTitle ?? ep.title, suffix, max: Math.max(30, 52 - suffix.length) });
  }

  // the editor model rewrites each line as a complete phrase inside its
  // budget; any bad output (missing, empty, way over) falls back to a plain
  // word-boundary trim of the original
  let texts = blocks.map((b) => (b.text.length <= b.max ? b.text : ogTruncate(b.text, b.max)));
  if (llmAvailable() && blocks.some((b) => b.text.length > b.max)) {
    try {
      const out = await compressTweetLines(blocks.map((b) => ({ text: b.text, max: b.max })));
      texts = blocks.map((b, i) => {
        const line = (out[i] ?? "").trim();
        return line.length > 0 && line.length <= b.max + 10 && !line.includes("…") ? line : texts[i];
      });
    } catch {
      // the word-boundary trims stand
    }
  }

  for (let squeeze = 0; squeeze <= 4; squeeze++) {
    const body = blocks
      .map((b, i) => `${b.label}\n${squeeze === 0 ? texts[i] : ogTruncate(texts[i], Math.max(24, blocks[i].max - squeeze * 6))}${b.suffix}`)
      .join("\n\n");
    const text = `${heading}\n\n${body}`;
    if (text.length <= 279) return text;
  }
  return ogTruncate(heading, 279);
}

/**
 * Post a two-tweet digest thread: the snapshot as clean text, then the
 * archive link as a reply. No image on tweet 1 by decision: the reply's link
 * unfurls into the archive page's card, and attaching the same card to
 * tweet 1 showed it twice.
 */
async function postThread(first: string, second: string): Promise<{ tweetId?: string; notes: string[] }> {
  const notes: string[] = [];
  const t1 = await postTextToX(first);
  if (t1.dryRun) return { notes: [...notes, "thread skipped (dry-run or no X credentials)"] };
  if (!t1.id) return { notes: [...notes, "thread tweet 1 returned no id"] };
  try {
    await postTextToX(second, { replyTo: t1.id });
  } catch (err) {
    notes.push(`thread reply failed: ${truncate(err instanceof Error ? err.message : String(err), 160)}`);
  }
  return { tweetId: t1.id, notes };
}

/**
 * The daily thread for yesterday's frozen digest. Its own step (not part of
 * the freeze) so a failed post retries on later runs until the tweetId is
 * written back onto the digest; skipped once the digest is over 36h old.
 */
async function maybePostDayThread(state: SiteState, cfg: SiteConfig, report: RunReport): Promise<void> {
  if (cfg.bots.x.dailyThread === false) return;
  const yesterday = utcDay(new Date(Date.now() - 24 * 60 * 60000).toISOString());
  const digest = await loadDailyDigest(yesterday);
  // an inProgress digest means yesterday's freeze hasn't run (or failed):
  // the thread must never post a preview as the day's edition
  if (!digest || digest.inProgress || digest.tweetId || hoursAgo(digest.takenAt) > 36) return;
  const first = await threadFirstTweet(`${siteIdentity().siteName} - ${tweetDate(digest.date)}`, digest.clusters, state, cfg, 36, digest.episodes?.[0]);
  const second = threadSecondTweet("day", `${cfg.bots.siteUrl}/day/${digest.date}`, cfg);
  const r = await postThread(first, second);
  if (r.tweetId) {
    digest.tweetId = r.tweetId;
    await saveDailyDigest(digest);
    report.notes.push(`day thread posted (${r.tweetId})${r.notes.length > 0 ? `, ${r.notes.join(", ")}` : ""}`);
  } else if (r.notes.length > 0) {
    report.notes.push(`day thread: ${r.notes.join(", ")}`);
  }
}

/**
 * The current day, week, month, and year as living digests: the same shape
 * as the frozen ones, flagged inProgress, refreshed every run and replaced
 * for good by their freezes (same storage keys). They give the archive pages
 * and word maps a "so far" view that costs one blob read to render, and they
 * never email, cast, or tweet.
 */
async function refreshInProgressDigests(state: SiteState, cfg: SiteConfig): Promise<void> {
  const now = new Date();
  const today = utcDay(now.toISOString());
  const takenAt = now.toISOString();
  const deep = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

  const { top, reviewPool } = dayTopClusters(state, cfg, today);
  if (top.length > 0) {
    const digest: DailyDigest = { date: today, takenAt, clusters: deep(top), inProgress: true };
    const topIds = new Set(top.map((c) => c.id));
    const also = reviewPool
      .filter((c) => !topIds.has(c.id))
      .slice(0, 8)
      .map((c) => ({ headline: c.headline, slug: c.slug, ...(c.section !== "general" ? { section: c.section } : {}) }));
    if (also.length > 0) digest.alsoActive = also;
    const dayEps = rankMedia(
      (state.mediaItems ?? []).filter((m) => !m.hidden && utcDay(m.publishedAt) === today),
      state,
      cfg.ranking
    ).slice(0, 4);
    const fallbackEps = dayEps.length > 0 ? dayEps : rankMedia((state.mediaItems ?? []).filter((m) => !m.hidden), state, cfg.ranking).slice(0, 1);
    if (fallbackEps.length > 0) digest.episodes = deep(fallbackEps);
    await saveDailyDigest(digest);
    state.dailyDigestDates = rememberDate(state.dailyDigestDates, today);
  }

  // the week so far: this Saturday through today, filed under the coming
  // Friday (the same key Saturday's freeze will overwrite)
  const sinceSat = (now.getUTCDay() + 1) % 7;
  const wkDays: string[] = [];
  for (let i = sinceSat; i >= 0; i--) wkDays.push(utcDay(new Date(now.getTime() - i * 86400000).toISOString()));
  const wkEnd = utcDay(new Date(now.getTime() + (6 - sinceSat) * 86400000).toISOString());
  const wkTop = rankPool(await poolFromDailies(wkDays), cfg, 10);
  if (wkTop.length > 0) {
    const weekly: WeeklyDigest = { start: wkDays[0], end: wkEnd, takenAt, clusters: deep(wkTop), inProgress: true };
    const weekEps = rankMedia(
      (state.mediaItems ?? []).filter((m) => !m.hidden && m.publishedAt >= `${wkDays[0]}T00:00:00.000Z`),
      state,
      cfg.ranking
    ).slice(0, 5);
    if (weekEps.length > 0) weekly.episodes = deep(weekEps);
    await saveWeeklyDigest(weekly);
    state.weeklyDigestDates = rememberDate(state.weeklyDigestDates, wkEnd);
  }

  const month = today.slice(0, 7);
  const m = await monthlyTop(state, cfg, month);
  if (m) {
    const monthly: MonthlyDigest = { month, takenAt, clusters: deep(m.top), inProgress: true };
    const monthEps = rankMedia(
      (state.mediaItems ?? []).filter((x) => !x.hidden && x.publishedAt.slice(0, 7) === month),
      state,
      cfg.ranking
    ).slice(0, 6);
    if (monthEps.length > 0) monthly.episodes = deep(monthEps);
    await saveMonthlyDigest(monthly);
    state.monthlyDigestMonths = rememberDate(state.monthlyDigestMonths, month);
  }

  // the year pool reads the month preview just saved above, so the current
  // month's stories and top episode are already in it
  const year = today.slice(0, 4);
  const y = await yearlyTop(state, cfg, year);
  if (y) {
    const yearly: YearlyDigest = { year, takenAt, clusters: deep(y.top), inProgress: true };
    if (y.episodes.length > 0) yearly.episodes = deep(y.episodes);
    await saveYearlyDigest(yearly);
    state.yearlyDigestYears = rememberDate(state.yearlyDigestYears, year);
  }
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
  cfg: SiteConfig,
  /** show-note links from shelved episodes: routed to known sources only, never to the candidate list */
  episodeLinks: Array<CastLink & { mediaId: string }> = []
): { items: CandidateItem[]; links: number; newHosts: string[] } {
  const links: Array<CastLink & { mediaId?: string }> = [...results.flatMap((r) => r.castLinks ?? []), ...episodeLinks];
  const newHosts: string[] = [];
  if (links.length === 0) return { items: [], links: 0, newHosts };

  const feedById = new Map(effectiveFeeds(state).map((f) => [f.id, f]));
  const sourceByHost = knownSourceHosts(state);
  // the site's own domain is never a source candidate: the digest bot casts
  // a link to it every day, and the discovery loop must not eat its own tail
  let selfHost = "";
  try {
    selfHost = normalizeHost(new URL(siteUrl()).hostname);
  } catch {}

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
        ...(link.mediaId ? { viaEpisode: link.mediaId } : { viaFarcaster: true }),
      });
      continue;
    }
    // show notes link to sponsors and shops as a matter of course: an unknown
    // host from an episode is not a source candidate
    if (link.mediaId) continue;
    if (selfHost && (link.host === selfHost || link.host.endsWith("." + selfHost))) continue;
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

/** The media shelf keeps a bounded page of recent episodes, nothing more. */
export const MAX_MEDIA_ITEMS = 200;

/**
 * YouTube's feed carries no length, so new videos (and, on re-judge, shelved
 * ones still missing it) get theirs from the Data API or the watch page.
 * Best effort: an episode without a length just shows none.
 */
async function fillVideoDetails(
  items: Array<{ url: string; kind: string; durationSec?: number; views?: number; likes?: number; statsAt?: string; publishedAt: string; upcoming?: boolean }>,
  timeoutMs: number,
  refreshStats = false
): Promise<number> {
  // lengths once; view counts while the episode is young (a week), at most
  // every three hours, since velocity is the ranking's main signal
  const now = Date.now();
  const stale = (i: { statsAt?: string; publishedAt: string }) =>
    now - Date.parse(i.publishedAt) <= 7 * 24 * 60 * 60000 &&
    (!i.statsAt || now - Date.parse(i.statsAt) >= 3 * 60 * 60000);
  const want = items.filter((i) => i.kind === "video" && (!i.durationSec || (refreshStats && stale(i))));
  const byId = new Map<string, typeof want>();
  for (const i of want) {
    const id = youtubeVideoId(i.url);
    if (!id) continue;
    byId.set(id, [...(byId.get(id) ?? []), i]);
  }
  if (byId.size === 0) return 0;
  const found = await fetchYoutubeDetails([...byId.keys()], timeoutMs);
  let filled = 0;
  const at = new Date().toISOString();
  for (const [id, d] of found) {
    for (const i of byId.get(id) ?? []) {
      if (d.durationSec && !i.durationSec) {
        i.durationSec = d.durationSec;
        filled += 1;
      }
      if (d.views !== undefined) {
        i.views = d.views;
        if (d.likes !== undefined) i.likes = d.likes;
        i.statsAt = at;
      }
      // a scheduled premiere is not an episode yet; one that aired gets its
      // honest publish time (the air time, not the listing's creation time)
      if (d.upcoming) i.upcoming = true;
      else {
        i.upcoming = undefined;
        if (d.airedAt) i.publishedAt = d.airedAt;
      }
    }
  }
  return filled;
}

/**
 * A show that publishes the same episode as a podcast and as a video would
 * shelve it twice under two titles. Pair them: same show, published within
 * two days, lengths within five percent. The podcast entry keeps its title
 * and label (it is the one a feed rule may have admitted) and takes the video
 * url and thumbnail so the player shows video; the video entry is hidden as
 * the twin. Runs over new and shelved episodes alike.
 */
function pairPodcastsWithVideos(items: MediaItem[]): number {
  let paired = 0;
  const videos = items.filter((m) => m.kind === "video" && m.durationSec);
  for (const pod of items) {
    if (pod.kind !== "podcast" || pod.videoUrl || !pod.durationSec) continue;
    const twin = videos.find(
      (v) =>
        v.sourceName === pod.sourceName &&
        !v.twinOf &&
        Math.abs(Date.parse(v.publishedAt) - Date.parse(pod.publishedAt)) <= 48 * 60 * 60000 &&
        Math.abs(v.durationSec! - pod.durationSec!) / pod.durationSec! <= 0.05
    );
    if (!twin) continue;
    pod.videoUrl = twin.url;
    if (!pod.thumbnail && twin.thumbnail) pod.thumbnail = twin.thumbnail;
    if (!pod.thumbStyle && twin.thumbStyle) pod.thumbStyle = twin.thumbStyle;
    if (!pod.section && !pod.roundup && twin.section) pod.section = twin.section;
    twin.twinOf = pod.id;
    twin.hidden = true;
    paired += 1;
  }
  // the podcast entry represents the episode on the shelf, so it ranks on its
  // twin's view count (the video keeps getting its stats refreshed while hidden)
  const byTwin = new Map(items.filter((m) => m.twinOf).map((m) => [m.twinOf as string, m]));
  for (const pod of items) {
    const twin = byTwin.get(pod.id);
    if (!twin || twin.views === undefined) continue;
    pod.views = twin.views;
    if (twin.likes !== undefined) pod.likes = twin.likes;
    if (twin.statsAt) pod.statsAt = twin.statsAt;
  }
  return paired;
}

/** A feed's titleRewrite, when it has one: one regex pass over the show's own title. */
function rewriteTitle(
  feed: { titleRewrite?: { pattern: string; replacement: string } } | undefined,
  title: string,
  publishedAt?: string
): string {
  if (!feed?.titleRewrite) return title;
  try {
    // the replacement may carry {date}, filled with the episode's publish
    // date as "Aug 21", so a recurring segment can be dated in its title
    const date = publishedAt
      ? new Date(publishedAt).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })
      : "";
    return title.replace(new RegExp(feed.titleRewrite.pattern, "i"), feed.titleRewrite.replacement.replace(/\{date\}/g, date));
  } catch {
    return title;
  }
}

/** Feed titles arrive with stray trailing separators ("Conference 2026 Recap Video |"); drop them. */
function cleanMediaTitle(title: string): string {
  return title
    .replace(/[\s|:\-\u2013\u2014\u00b7]+$/u, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Re-run the media gate over what is already on the shelf, so a tightened
 * rule applies to episodes judged under the old one: tier 2 episodes that
 * now fail are hidden (kept in the admin), every episode picks up its
 * section label, and titles get the current cleanup. Tier 1 episodes are
 * never re-gated, only labeled.
 */

/**
 * Editor override: put one YouTube video on the shelf directly, skipping the
 * media gate (which judges a show's stream, not a hand-picked episode). The
 * details come from the Data API; if the video's channel is one of the
 * configured shows, the episode adopts that feed's identity so the kicker,
 * tier, and thumbnail style behave as if it arrived normally.
 */
export async function addMediaByUrl(state: SiteState, rawUrl: string, cfg: SiteConfig, section?: SectionId): Promise<string> {
  const vid = youtubeVideoId(rawUrl);
  if (!vid) return "Only YouTube links can be added as episodes for now.";
  const url = `https://www.youtube.com/watch?v=${vid}`;
  const items = state.mediaItems ?? [];
  if (items.some((m) => youtubeVideoId(m.videoUrl ?? m.url) === vid)) return "That episode is already on the shelf.";
  const details = await fetchYoutubeDetails([vid], cfg.ingest.feedTimeoutMs, 0, true);
  const d = details.get(vid);
  if (!d?.title) return "Could not read that video from the YouTube API.";
  if (d.upcoming) return "That video is a scheduled premiere that has not aired yet.";
  const now = new Date().toISOString();
  const feed = effectiveFeeds(state).find((f) => d.channelId && f.url.includes(`channel_id=${d.channelId}`));
  const links = extractDescriptionLinks(d.description);
  const chapters = extractChapters(d.description ?? "");
  const item: MediaItem = {
    id: dedupeKeyUrl(url).slice(0, 12),
    kind: "video",
    url,
    title: cleanMediaTitle(feed ? rewriteTitle(feed, d.title, d.publishedAt ?? now) : d.title),
    tier: feed?.tier ?? 2,
    ...(section ? { section } : {}),
    sourceId: feed?.id ?? "admin-add",
    sourceName: feed?.name ?? d.channel ?? "YouTube",
    publishedAt: d.airedAt ?? d.publishedAt ?? now,
    ingestedAt: now,
    thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
    ...(feed?.thumbStyle && feed.thumbStyle !== "episode" ? { thumbStyle: feed.thumbStyle } : {}),
    ...(d.durationSec ? { durationSec: d.durationSec } : {}),
    ...(d.views !== undefined ? { views: d.views, statsAt: now } : {}),
    ...(d.likes !== undefined ? { likes: d.likes } : {}),
    ...(links.length > 0 ? { links } : {}),
    ...(chapters.length > 0 ? { chapters } : {}),
  };
  state.seen[dedupeKeyUrl(url)] = now;
  state.mediaItems = [item, ...items]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, MAX_MEDIA_ITEMS);
  // pair right away, so adding a show's video upgrades its podcast row to
  // video in this same click instead of waiting for the next hourly ingest
  const paired = pairPodcastsWithVideos(state.mediaItems);
  const mentions = await linkEpisodesToStories(state);
  if (paired > 0 && item.hidden) {
    return `Added \u201c${item.title}\u201d and paired it as the video for its podcast episode. The podcast row now plays video.`;
  }
  return `Added \u201c${item.title}\u201d to the shelf${mentions > 0 ? ` with ${mentions} story mention(s) from its notes` : ""}. It ranks like any episode.`;
}

export async function rejudgeMedia(
  state: SiteState,
  mediaFeeds: ReturnType<typeof effectiveFeeds>,
  timeoutMs: number = loadSiteConfig().ingest.feedTimeoutMs
): Promise<{ note: string }> {
  const items = state.mediaItems ?? [];
  if (items.length === 0) return { note: "Nothing on the shelf to re-judge." };
  const feedById = new Map(mediaFeeds.map((f) => [f.id, f]));
  let clips = 0;
  for (const m of items) {
    m.title = cleanMediaTitle(rewriteTitle(feedById.get(m.sourceId), m.title, m.publishedAt));
    const hint = feedById.get(m.sourceId)?.sectionHint;
    if (feedById.get(m.sourceId)?.roundup) {
      m.roundup = true;
      delete m.section;
    } else {
      delete m.roundup;
      if (!m.section && hint) m.section = hint;
    }
    const ts = feedById.get(m.sourceId)?.thumbStyle;
    if (ts && ts !== "episode") m.thumbStyle = ts;
    else delete m.thumbStyle;
    const tier = feedById.get(m.sourceId)?.tier;
    if (!m.tier && tier) m.tier = tier;
    // clips shelved before ingest learned to skip them
    if (!m.hidden && isYoutubeShort(m.url)) {
      m.hidden = true;
      clips += 1;
    }
  }
  // hidden ones too: a hidden video may be the twin of a podcast episode, and pairing needs both lengths
  const filled = await fillVideoDetails(items, timeoutMs, true);
  // scheduled premieres that slipped onto the shelf leave it and are
  // forgotten, so they come back on their own once they air
  const upcoming = items.filter((m) => m.upcoming);
  if (upcoming.length > 0) {
    state.mediaItems = items.filter((m) => !m.upcoming);
    for (const m of upcoming) {
      delete state.seen[dedupeKeyUrl(m.url)];
      delete state.seen[dedupeKeyContent(m.title, m.sourceId)];
    }
  }
  const kept2 = state.mediaItems ?? [];
  const paired = pairPodcastsWithVideos(kept2);
  // episodes shelved before show notes were read get their description now
  // mentions rebuild from scratch under the current matching rules, so a
  // tightened matcher clears earlier junk
  for (const c of Object.values(state.clusters)) delete c.mentions;
  for (const m of kept2) delete m.notesLinkedAt;
  const noNotes = kept2.filter((m) => m.kind === "video" && !m.links && !m.chapters);
  if (noNotes.length > 0) {
    const byId = new Map<string, MediaItem[]>();
    for (const m of noNotes) {
      const id = youtubeVideoId(m.url);
      if (id) byId.set(id, [...(byId.get(id) ?? []), m]);
    }
    const found = await fetchYoutubeDetails([...byId.keys()], timeoutMs, 0, true);
    for (const [id, d] of found) {
      for (const m of byId.get(id) ?? []) {
        const links = extractDescriptionLinks(d.description);
        const chapters = extractChapters(d.description);
        if (links.length > 0) m.links = links;
        if (chapters.length > 0) m.chapters = chapters;
      }
    }
  }
  const mentions = await linkEpisodesToStories(state);
  const gated = kept2.filter((m) => !m.hidden && (feedById.get(m.sourceId)?.tier ?? 1) !== 1);
  if (gated.length === 0) return { note: `Shelf re-labeled, ${filled} length(s) filled in; no tier 2 episodes to re-judge.` };
  if (!llmAvailable()) return { note: "Shelf re-labeled; LLM not configured, so nothing was re-judged." };
  let hidden = 0;
  for (let i = 0; i < gated.length; i += 40) {
    const chunk = gated.slice(i, i + 40);
    const verdicts = await gateMediaItems(
      chunk.map((m) => ({ id: m.id, show: m.sourceName, title: m.title, excerpt: m.excerpt }))
    );
    for (const m of chunk) {
      const v = verdicts[m.id];
      if (!v?.onTopic) {
        m.hidden = true;
        hidden += 1;
      } else if (v.section && !m.roundup) m.section = v.section;
    }
  }
  return { note: `Re-judged ${gated.length} tier 2 episode(s): ${hidden} hidden, the rest kept and labeled. ${filled} length(s) filled in.${clips > 0 ? ` ${clips} Shorts clip(s) hidden.` : ""}${paired > 0 ? ` ${paired} podcast episode(s) paired with their video.` : ""}${upcoming.length > 0 ? ` ${upcoming.length} scheduled premiere(s) removed until they air.` : ""}${mentions > 0 ? ` ${mentions} story mention(s) from show notes.` : ""}` };
}

/**
 * Show notes tie episodes to stories. Deterministic signals first: a note
 * link that matches one of a live story's articles, and a chapter naming a
 * proposal number that exactly one live non-roundup story names. Everything
 * softer is a meaning call, not a word-overlap call (overlap matched "What
 * Actually Breaks With More ETH Staked?" to a treasury-purchase story on
 * "more" and "eth"), so remaining chapters go to the editor model in one
 * batched call, where "no match" is the normal answer. Runs at media ingest
 * and on Re-judge; without an LLM only the deterministic signals apply.
 */
async function linkEpisodesToStories(state: SiteState, only?: MediaItem[]): Promise<number> {
  const pool = (only ?? state.mediaItems ?? []).filter(
    (m) => !m.hidden && !m.notesLinkedAt && ((m.links?.length ?? 0) > 0 || (m.chapters?.length ?? 0) > 0)
  );
  if (pool.length === 0) return 0;
  const live = liveClusters(state);
  const byUrl = new Map<string, Cluster>();
  for (const c of live) for (const l of c.links) byUrl.set(normalizeUrl(l.url), c);
  const byId = new Map(live.map((c) => [c.id, c]));
  const now = new Date().toISOString();
  let added = 0;
  const mention = (c: Cluster, m: MediaItem, at?: number) => {
    const list = (c.mentions ??= []);
    const existing = list.find((x) => x.mediaId === m.id);
    if (existing) {
      if (at !== undefined && (existing.at === undefined || at < existing.at)) existing.at = at;
      return;
    }
    list.push({ mediaId: m.id, show: m.sourceName, title: m.displayTitle ?? m.title, kind: m.kind, ...(at !== undefined ? { at } : {}), addedAt: now });
    if (list.length > 6) list.splice(0, list.length - 6);
    // deliberately NOT bumping c.updatedAt: a podcast chapter discussing a
    // story is not new coverage, and updatedAt doubles as the "recently
    // active" clock for the editor's context window, so a mention pass can
    // resurrect old stories into the front summary.
    added += 1;
  };
  const unresolved: Array<{ id: string; show: string; title: string; chapters: Array<{ at: number; label: string }> }> = [];
  for (const m of pool) {
    const linkAt = new Map<string, number>();
    for (const ch of m.chapters ?? []) for (const l of ch.links ?? []) linkAt.set(normalizeUrl(l), ch.at);
    for (const l of m.links ?? []) {
      const c = byUrl.get(normalizeUrl(l));
      if (c) mention(c, m, linkAt.get(normalizeUrl(l)));
    }
    const soft: Array<{ at: number; label: string }> = [];
    for (const ch of m.chapters ?? []) {
      if (ch.links && ch.links.some((l) => byUrl.has(normalizeUrl(l)))) continue; // placed by its link
      // a proposal number is an identity: when exactly one live non-roundup
      // story names it, the chapter is about that story, no judgment needed
      const ids = proposalIds(ch.label);
      if (ids.size > 0) {
        const named = live.filter((c) => c.section !== "general" && [...proposalIds(`${c.headline} ${c.keywords.join(" ")}`)].some((x) => ids.has(x)));
        if (named.length === 1) {
          mention(named[0], m, ch.at);
          continue;
        }
      }
      if (ch.label.length >= 8) soft.push({ at: ch.at, label: ch.label });
    }
    if (soft.length > 0) unresolved.push({ id: m.id, show: m.sourceName, title: m.displayTitle ?? m.title, chapters: soft.slice(0, 20) });
    m.notesLinkedAt = now;
  }
  if (unresolved.length > 0 && llmAvailable()) {
    try {
      const stories = live.filter((c) => c.section !== "general").map((c) => ({ id: c.id, headline: c.headline }));
      const poolById = new Map(pool.map((m) => [m.id, m]));
      const matches = await matchChaptersToStories(unresolved, stories);
      for (const match of matches) {
        const c = byId.get(match.storyId);
        const m = poolById.get(match.episodeId);
        if (c && m && c.section !== "general") mention(c, m, match.at);
      }
    } catch {
      // best effort: deterministic mentions stand, the model pass retries never
      // (chapters are marked linked); Re-judge can always rebuild
    }
  }
  return added;
}

/**
 * Fetch, dedupe, gate, and shelve media episodes. Tier 1 shows pass straight
 * through (whitelisting was the curation); tier 2 shows face the media gate,
 * because broad shows are only sometimes about the site's topic. A gate
 * failure holds that batch unseen so the next run retries it, mirroring the
 * news path.
 */
export async function ingestMedia(
  state: SiteState,
  mediaFeeds: ReturnType<typeof effectiveFeeds>,
  cfg: SiteConfig
): Promise<{ errors: Array<{ feedId: string; error: string }>; note?: string }> {
  const results = await fetchMediaFeeds(mediaFeeds, cfg.ingest);
  const feedById = new Map(mediaFeeds.map((f) => [f.id, f]));
  const errors = results.filter((r) => r.error).map((r) => ({ feedId: r.feed.id, error: r.error! }));
  const fresh = selectNewItems(state, results.flatMap((r) => r.items)) as Array<MediaCandidate & { id: string }>;

  // a show segment that always belongs (a weekly roundup) skips the gate on
  // its feed's alwaysPattern and takes the feed's section label
  const alwaysRe = new Map(mediaFeeds.filter((f) => f.alwaysPattern).map((f) => [f.id, new RegExp(f.alwaysPattern!, "i")]));
  const always = (i: MediaCandidate) => alwaysRe.get(i.sourceId)?.test(i.title) ?? false;
  const passthrough = fresh.filter((i) => i.tier === 1 || always(i));
  const gated = fresh.filter((i) => i.tier !== 1 && !always(i));
  const kept = [...passthrough];
  const judged = [...passthrough];
  let rejected = 0;
  let held = 0;
  let heldReason = "";
  const gateSection = new Map<string, SectionId>();
  const twinOnly = new Set<string>();
  // A gate-rejected video may still be the video half of a podcast episode
  // the shelf already carries (a roundup's YouTube upload can be retitled
  // into something the gate rightly fails). Such a video shelves HIDDEN
  // instead of dropping, so the twin pairing below can adopt it.
  const podSibling = (item: MediaCandidate): boolean => {
    const near = (m: { kind?: string; sourceName: string; publishedAt: string; videoUrl?: string }) =>
      m.kind === "podcast" && !m.videoUrl && m.sourceName === item.sourceName &&
      Math.abs(Date.parse(m.publishedAt) - Date.parse(item.publishedAt)) <= 48 * 60 * 60000;
    return (state.mediaItems ?? []).some(near) || kept.some(near);
  };

  if (gated.length > 0) {
    if (llmAvailable()) {
      try {
        const verdicts = await gateMediaItems(
          gated.map((i) => ({ id: i.id, show: i.sourceName, title: i.title, excerpt: i.excerpt }))
        );
        for (const item of gated) {
          judged.push(item);
          const v = verdicts[item.id];
          if (v?.onTopic) {
            kept.push(item);
            if (v.section) gateSection.set(item.id, v.section);
          } else if (item.kind === "video" && podSibling(item)) {
            kept.push(item);
            twinOnly.add(item.id);
          } else rejected += 1;
        }
      } catch (err) {
        // unseen, so the next run simply retries them
        held = gated.length;
        heldReason = err instanceof Error ? err.message : String(err);
      }
    } else {
      // deliberate no-key mode: tier-2 episodes cannot be judged, so they are
      // dropped (and marked seen) rather than queued forever
      judged.push(...gated);
      rejected += gated.length;
    }
  }

  await fillVideoDetails(kept, cfg.ingest.feedTimeoutMs);
  // a scheduled premiere stays unseen, so it arrives on its own once it airs,
  // with its publish time set to the air time by the details fill
  const ready = kept.filter((i) => !i.upcoming);
  const scheduled = kept.length - ready.length;
  for (const item of judged) {
    if (!(item as MediaCandidate).upcoming) markSeen(state, item);
  }
  const now = new Date().toISOString();
  const shelved: MediaItem[] = ready.map((i) => ({
    id: i.id,
    kind: i.kind,
    url: i.url,
    title: cleanMediaTitle(rewriteTitle(feedById.get(i.sourceId), i.title, i.publishedAt)),
    tier: i.tier,
    // a label, not a bucket: tier 1 shows carry the feed's hint, tier 2
    // episodes get the gate's call, and the episode also shows in that
    // section's rail
    ...(feedById.get(i.sourceId)?.roundup
      ? { roundup: true }
      : (gateSection.get(i.id) ?? i.sectionHint)
        ? { section: gateSection.get(i.id) ?? i.sectionHint }
        : {}),
    sourceId: i.sourceId,
    sourceName: i.sourceName,
    publishedAt: i.publishedAt,
    ingestedAt: now,
    ...(i.thumbnail ? { thumbnail: i.thumbnail } : {}),
    ...((): Partial<MediaItem> => {
      const t = feedById.get(i.sourceId)?.thumbStyle;
      return t && t !== "episode" ? { thumbStyle: t } : {};
    })(),
    ...(i.durationSec ? { durationSec: i.durationSec } : {}),
    ...(i.audioUrl ? { audioUrl: i.audioUrl } : {}),
    ...(i.videoUrl ? { videoUrl: i.videoUrl } : {}),
    ...(i.descriptionLinks && i.descriptionLinks.length > 0 ? { links: i.descriptionLinks } : {}),
    ...(i.chapters && i.chapters.length > 0 ? { chapters: i.chapters } : {}),
    ...(i.excerpt ? { excerpt: truncate(i.excerpt, 300) } : {}),
  }));
  for (const s of shelved) {
    if (twinOnly.has(s.id)) {
      s.hidden = true;
      delete s.section;
    }
  }
  state.mediaItems = [...shelved, ...(state.mediaItems ?? [])]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, MAX_MEDIA_ITEMS);
  // keep view counts fresh for young episodes so the ranked boxes track what
  // people are actually watching (one API call per fifty videos), then pair
  // podcast episodes with their video twins so they inherit those numbers
  for (const m of state.mediaItems) {
    const ts = feedById.get(m.sourceId)?.thumbStyle;
    if (ts && ts !== "episode") m.thumbStyle = ts;
    else delete m.thumbStyle;
    if (feedById.get(m.sourceId)?.roundup) {
      m.roundup = true;
      delete m.section;
    } else delete m.roundup;
  }
  // a videoManifest is the live source of truth for its show's video file,
  // card art, and chapters: shelved episodes re-sync every ingest, so a
  // rendition or chapter list the show adds later reaches episodes that
  // already shelved
  for (const f of mediaFeeds.filter((x) => x.videoManifest)) {
    const manifest = await fetchVideoManifest(f, cfg.ingest.feedTimeoutMs);
    if (!manifest) continue;
    const stem = (u?: string): string | null => {
      if (!u) return null;
      try {
        const p = new URL(u);
        const fname = p.searchParams.get("filename");
        if (fname) return fname.replace(/\.[a-z0-9]+$/i, "");
        return p.pathname.split("/").filter(Boolean).pop() ?? null;
      } catch {
        return null;
      }
    };
    for (const m of state.mediaItems.filter((x) => x.sourceId === f.id)) {
      const entry = (stem(m.audioUrl) && manifest.get(stem(m.audioUrl)!)) || (stem(m.url) && manifest.get(stem(m.url)!)) || null;
      if (!entry) continue;
      if (entry.videoUrl) {
        m.videoUrl = entry.videoUrl;
        m.kind = "video";
      }
      if (entry.thumbnail) m.thumbnail = entry.thumbnail;
      if (entry.chapters) m.chapters = entry.chapters;
    }
  }
  await fillVideoDetails(state.mediaItems, cfg.ingest.feedTimeoutMs, true);
  pairPodcastsWithVideos(state.mediaItems);
  const mentions = await linkEpisodesToStories(state);
  updateFeedHealth(state, results, new Set(shelved.map((i) => i.sourceId)));

  const note =
    fresh.length > 0 || held > 0 || mentions > 0 || scheduled > 0
      ? `Media: ${shelved.length} episode(s) shelved, ${rejected} gated out${twinOnly.size > 0 ? `, ${twinOnly.size} gate-rejected video(s) kept hidden as twin candidate(s)` : ""}${held > 0 ? `, ${held} held for retry (gate failed: ${truncate(heldReason, 160)})` : ""}${mentions > 0 ? `, ${mentions} story mention(s) from show notes` : ""}${scheduled > 0 ? `, ${scheduled} scheduled premiere(s) waiting to air` : ""}.`
      : undefined;
  return { errors, note };
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
  // the media shelf ages out by ingest time; hidden items expire with the rest
  if (state.mediaItems) {
    state.mediaItems = state.mediaItems.filter((m) => hoursAgo(m.ingestedAt) <= 90 * 24).slice(0, MAX_MEDIA_ITEMS);
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
  if (entry.alsoIn && entry.alsoIn !== entry.section) cluster.alsoIn = entry.alsoIn;
  else delete cluster.alsoIn;
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

/**
 * Reconsider the front summary against the page's current stories without a
 * full editor pass. Admin actions that change a story flag the summary stale
 * (a line may now claim something its story no longer says); the refresh
 * prompt reuses still-accurate lines verbatim, so running this never reworks
 * the box for its own sake.
 */
export async function reconsiderFrontSummary(state: SiteState, cfg: SiteConfig): Promise<{ note: string; changed: boolean }> {
  const summary = state.frontSummary;
  if (!summary?.text) return { note: "No front summary to reconsider.", changed: false };
  if (!llmAvailable()) return { note: "LLM not configured. Front summary left unchanged.", changed: false };
  const lines = parseSummaryLines(summary.text)
    .filter((l) => l.section)
    .map((l) => ({ section: l.section!, ref: l.ref ?? undefined, text: l.text }));
  const weekend = weekendMode(cfg.ranking, new Date(), state.weekendSchedule);
  const top = weekend ? weekInReview(state, cfg.ranking, new Set()) : topStories(state, cfg.ranking).slice(0, 6);
  const bullets = await refreshFrontSummary(lines, top, weekend);
  const resolveRef = (ref: string): string | undefined => {
    const c = state.clusters[ref];
    return c && !c.killed && /^[a-z0-9]+$/.test(ref) ? ref : undefined;
  };
  const text = joinSummaryLines(bullets, resolveRef);
  if (!text) {
    summary.stale = false;
    return { note: "Front summary reconsidered: editor returned nothing, left unchanged.", changed: false };
  }
  const merged = backfillSummarySections(carryForwardSummary(text, summary.text), state, cfg);
  if (merged === summary.text) {
    summary.stale = false;
    return { note: "Front summary reconsidered: still accurate, unchanged.", changed: false };
  }
  state.frontSummary = { text: merged, at: new Date().toISOString() };
  return { note: "Front summary refreshed: a line no longer matched its story.", changed: true };
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
  const allFeeds = effectiveFeeds(state);
  // media feeds fill the shelf beside the news flow; they never enter the
  // gate/cluster path, so the news fetch only sees the rest
  const mediaFeeds = allFeeds.filter(isMediaFeed);
  const feeds = allFeeds.filter((f) => !isMediaFeed(f));

  const report: RunReport = {
    fetchedFeeds: allFeeds.length,
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

  // show-note links from episodes not yet routed ride the same discovery path
  // as Farcaster casts: a link to a whitelisted source becomes an item, a
  // link into an existing story is a mention (handled at media ingest)
  const episodeLinks: Array<CastLink & { mediaId: string }> = [];
  for (const m of state.mediaItems ?? []) {
    if (m.hidden || !m.links || m.linksRoutedAt) continue;
    for (const url of m.links) {
      try {
        episodeLinks.push({ url, host: normalizeHost(new URL(url).hostname), author: m.sourceName, reach: m.views ?? 0, engagement: 0, text: m.displayTitle ?? m.title, at: m.publishedAt, mediaId: m.id });
      } catch {
        // not a url
      }
    }
    m.linksRoutedAt = new Date().toISOString();
  }
  const fc = routeCastLinks(state, results, cfg, episodeLinks);
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

  // One editor call handles a bounded batch. Normal runs see a handful of
  // items; a backlog after an outage can be dozens, and headline quality
  // drops with batch size (a newsletter issue once inherited the previous
  // issue's framing in a forty item call). Oldest first so nothing ages past
  // the ingest cutoff while it waits. Items left out stay unseen, so the next
  // run simply picks them up.
  const batchCap = cfg.ingest.maxEditorBatch ?? 30;
  if (newItems.length > batchCap) {
    const deferred = newItems.length - batchCap;
    newItems = [...newItems].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt)).slice(0, batchCap);
    report.notes.push(`Editor batch capped at ${batchCap}; ${deferred} newer item(s) wait for the next run.`);
  }

  let rejectedSamples: Array<{ title: string; source: string; reason: string }> = [];
  report.newItems = newItems.length;
  updateFeedHealth(state, results, new Set(newItems.map((i) => i.sourceId)));

  let contentChanged = false;
  if (newItems.length > 0) {
    await enrichNewItems(newItems, feeds, cfg.ingest.feedTimeoutMs);
    await enrichReleaseItems(newItems, report);
    let out: EditorOutput | null;
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
        // an outage that alerted gets a recovery note, then the streak resets
        if (state.llmAlertedAt) {
          await sendAdminEmail(
            `${siteIdentity().siteName}: editor LLM recovered`,
            `Editor calls are succeeding again after ${state.llmFailStreak ?? 0} failed run(s). Held items are flowing normally.`
          );
        }
        state.llmFailStreak = 0;
        delete state.llmAlertedAt;
      } catch (err) {
        // A transient LLM failure must not swallow the batch. Applying the
        // fallback here used to reject every tier-2 item AND mark it seen,
        // silently eating whatever arrived during an outage. Holding the
        // items unseen instead means the next run simply retries them.
        report.notes.push(
          `LLM failed, holding ${newItems.length} item(s) for retry next run: ${err instanceof Error ? err.message : err}`
        );
        out = null;
        // three failures in a row (~15 minutes of runs) reads as an outage,
        // not a blip: credit exhaustion, a rotated key, or the provider down.
        // One email per outage; recovery clears the latch above.
        state.llmFailStreak = (state.llmFailStreak ?? 0) + 1;
        if (state.llmFailStreak >= 3 && !state.llmAlertedAt) {
          state.llmAlertedAt = new Date().toISOString();
          const sent = await sendAdminEmail(
            `${siteIdentity().siteName}: editor LLM failing, items on hold`,
            `The editor call has failed ${state.llmFailStreak} runs in a row. New items are held and retried automatically, so nothing is lost, but the front page stops updating until calls succeed.\n\nLatest error: ${err instanceof Error ? err.message : err}\n\nUsual causes: API credit run out, a rotated or revoked key, or a provider outage.\n\nRun log: ${cfg.bots.siteUrl}/admin/runs`
          );
          if (sent) report.notes.push("Admin alerted by email about the LLM outage.");
        }
      }
    } else {
      // deliberate no-key mode: the degraded gate still applies (and marks
      // seen), because with no key there is nothing to wait for
      report.notes.push("No LLM key configured; heuristic fallback (tier-1 only, needs review).");
      out = heuristicFallback(newItems);
    }
    if (out) {
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
        text: backfillSummarySections(carryForwardSummary(summaryText, state.frontSummary?.text), state, cfg),
        at: new Date().toISOString(),
      };
    }
    }
  }

  try {
    const swings = await maybeMarketStories(state, cfg);
    if (swings.created > 0) contentChanged = true;
    report.notes.push(...swings.notes);
  } catch (err) {
    report.notes.push(`Polymarket check failed: ${err instanceof Error ? err.message : err}`);
  }

  // The media shelf ingests beside the news flow: no clustering, no
  // corroboration, its own gate. A failure here must never cost a news run,
  // and shelf changes never trigger snapshots (snapshots are story history).
  // Hourly, not every run: episodes do not need the news cadence, and the
  // sequential YouTube fetch is the slowest part of a run.
  if (mediaFeeds.length > 0 && (!state.lastMediaIngestAt || hoursAgo(state.lastMediaIngestAt) >= 0.9)) {
    try {
      const media = await ingestMedia(state, mediaFeeds, cfg);
      report.feedErrors.push(...media.errors);
      if (media.note) report.notes.push(media.note);
      state.lastMediaIngestAt = new Date().toISOString();
    } catch (err) {
      report.notes.push(`Media ingest failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  prune(state);

  // The editor's summary pass only runs when new items arrive, but the box can
  // go stale on a quiet run too: an admin corrected a story a line cites, or a
  // cited story died. Reconsider it here; still-accurate lines come back
  // verbatim, so this never churns the box just because a run happened.
  if (state.frontSummary?.text) {
    if (
      !state.frontSummary.stale &&
      parseSummaryLines(state.frontSummary.text).some((l) => l.ref && (!state.clusters[l.ref] || state.clusters[l.ref].killed))
    ) {
      state.frontSummary.stale = true;
    }
    if (state.frontSummary.stale && llmAvailable()) {
      try {
        const r = await reconsiderFrontSummary(state, cfg);
        report.notes.push(r.note);
        if (r.changed) contentChanged = true;
      } catch (err) {
        report.notes.push(`Front summary refresh failed, retrying next run: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

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

  // the day thread on X, retried until it lands (see maybePostDayThread)
  try {
    await maybePostDayThread(state, cfg, report);
  } catch (err) {
    report.notes.push(`day thread failed: ${err instanceof Error ? err.message : err}`);
  }

  // Saturday-morning weekly edition: the prior Saturday to Friday's top
  // stories, assembled from the frozen daily digests, once per Saturday. The
  // frozen /week page comes FIRST so the email and thread can link a page
  // that exists
  const nowUtc = new Date();
  if (nowUtc.getUTCDay() === 6 && nowUtc.getUTCHours() >= WEEKLY_SEND_HOUR_UTC && (state.lastWeeklyDigest ?? "") !== today) {
    let weekly: WeeklyDigest | null = null;
    try {
      const week = await weeklyTop(state, cfg);
      if (week) {
        weekly = {
          start: utcDay(week.start.toISOString()),
          end: utcDay(week.end.toISOString()),
          takenAt: new Date().toISOString(),
          clusters: JSON.parse(JSON.stringify(week.top)) as Cluster[],
        };
        // the week's top podcasts freeze in, playable on the /week page
        const weekStart = `${weekly.start}T00:00:00.000Z`;
        const weekEndEx = new Date(new Date(`${weekly.end}T00:00:00Z`).getTime() + 24 * 60 * 60000).toISOString();
        const weekEps = rankMedia(
          (state.mediaItems ?? []).filter((m) => !m.hidden && m.publishedAt >= weekStart && m.publishedAt < weekEndEx),
          state,
          cfg.ranking
        ).slice(0, 5);
        if (weekEps.length > 0) weekly.episodes = JSON.parse(JSON.stringify(weekEps)) as MediaItem[];
        weekly.contentHash = digestContentHash(weekly);
        await saveWeeklyDigest(weekly);
        state.weeklyDigestDates = rememberDate(state.weeklyDigestDates, weekly.end);
        report.notes.push(`Weekly digest ${weekly.end}: ${weekly.clusters.length} stories frozen`);
      }
    } catch (err) {
      report.notes.push(`Weekly digest freeze failed: ${err instanceof Error ? err.message : err}`);
    }
    try {
      const note = await sendWeeklyEmail(state, cfg);
      if (note) report.notes.push(note);
    } catch (err) {
      report.notes.push(`Weekly email failed: ${err instanceof Error ? err.message : err}`);
    }
    // the weekly cast and thread share the same snapshot text, so both
    // platforms tell one edition; the /week page rides along as the embed
    let weeklyFirst: string | null = null;
    if (weekly) {
      try {
        weeklyFirst = await threadFirstTweet(
          `${siteIdentity().siteName} - ${subjectRangeLabel(new Date(`${weekly.start}T00:00:00Z`), new Date(`${weekly.end}T00:00:00Z`))}`,
          weekly.clusters,
          state,
          cfg,
          7 * 24,
          weekly.episodes?.[0]
        );
      } catch (err) {
        report.notes.push(`weekly snapshot text failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    try {
      if (weekly && weeklyFirst) {
        const r = await castRaw(`${weeklyFirst}\n\n${subscribeLines(cfg)}`, `${cfg.bots.siteUrl}/week/${weekly.end}`, cfg.bots.farcaster.digestChannel || undefined);
        report.notes.push(r.dryRun ? "Weekly cast skipped (dry-run or no credentials)." : "Weekly cast posted.");
      } else {
        const wc = await buildWeeklyCast(state, cfg);
        if (wc) {
          const r = await castRaw(`${wc.text}\n\n${subscribeLines(cfg)}`, wc.url, cfg.bots.farcaster.digestChannel || undefined);
          report.notes.push(r.dryRun ? "Weekly cast skipped (dry-run or no credentials)." : "Weekly cast posted.");
        } else {
          report.notes.push("Weekly cast skipped (fewer than three stories this week).");
        }
      }
    } catch (err) {
      report.notes.push(`Weekly cast failed: ${err instanceof Error ? err.message : err}`);
    }
    // the weekly thread on X, same shape as the daily
    if (weekly && weeklyFirst && cfg.bots.x.weeklyThread !== false) {
      try {
        const second = threadSecondTweet("week", `${cfg.bots.siteUrl}/week/${weekly.end}`, cfg);
        const r = await postThread(weeklyFirst, second);
        if (r.tweetId) {
          weekly.tweetId = r.tweetId;
          await saveWeeklyDigest(weekly);
          report.notes.push(`week thread posted (${r.tweetId})${r.notes.length > 0 ? `, ${r.notes.join(", ")}` : ""}`);
        } else if (r.notes.length > 0) {
          report.notes.push(`week thread: ${r.notes.join(", ")}`);
        }
      } catch (err) {
        report.notes.push(`week thread failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    state.lastWeeklyDigest = today;
  }

  // First-of-month monthly edition: the prior calendar month's top stories,
  // pooled from its frozen dailies. Same morning hour as the weekly, so on a
  // Saturday the 1st both go out. The frozen /month page comes FIRST so the
  // email, cast, and thread link a page that exists. The monthly email rides
  // the weekly list by decision: no third subscription checkbox.
  const thisMonth = today.slice(0, 7);
  if (nowUtc.getUTCDate() === 1 && nowUtc.getUTCHours() >= WEEKLY_SEND_HOUR_UTC && (state.lastMonthlyDigest ?? "") !== thisMonth) {
    const prevMonth = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    let monthly: MonthlyDigest | null = null;
    try {
      const m = await monthlyTop(state, cfg, prevMonth);
      if (m) {
        monthly = {
          month: prevMonth,
          takenAt: new Date().toISOString(),
          clusters: JSON.parse(JSON.stringify(m.top)) as Cluster[],
        };
        const monthEps = rankMedia(
          (state.mediaItems ?? []).filter((x) => !x.hidden && x.publishedAt.slice(0, 7) === prevMonth),
          state,
          cfg.ranking
        ).slice(0, 6);
        if (monthEps.length > 0) monthly.episodes = JSON.parse(JSON.stringify(monthEps)) as MediaItem[];
        monthly.contentHash = digestContentHash(monthly);
        await saveMonthlyDigest(monthly);
        state.monthlyDigestMonths = rememberDate(state.monthlyDigestMonths, prevMonth);
        report.notes.push(`Monthly digest ${prevMonth}: ${monthly.clusters.length} stories frozen`);
      }
    } catch (err) {
      report.notes.push(`Monthly digest freeze failed: ${err instanceof Error ? err.message : err}`);
    }
    try {
      const note = await sendMonthlyEmail(state, cfg, prevMonth);
      if (note) report.notes.push(note);
    } catch (err) {
      report.notes.push(`Monthly email failed: ${err instanceof Error ? err.message : err}`);
    }
    // the monthly cast and thread share one snapshot text, like the weekly
    let monthlyFirst: string | null = null;
    if (monthly) {
      try {
        monthlyFirst = await threadFirstTweet(
          `${siteIdentity().siteName} - ${monthLabel(prevMonth)}`,
          monthly.clusters,
          state,
          cfg,
          31 * 24,
          monthly.episodes?.[0]
        );
      } catch (err) {
        report.notes.push(`monthly snapshot text failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    try {
      if (monthly && monthlyFirst) {
        const r = await castRaw(`${monthlyFirst}\n\n${subscribeLines(cfg)}`, `${cfg.bots.siteUrl}/month/${prevMonth}`, cfg.bots.farcaster.digestChannel || undefined);
        report.notes.push(r.dryRun ? "Monthly cast skipped (dry-run or no credentials)." : "Monthly cast posted.");
      }
    } catch (err) {
      report.notes.push(`Monthly cast failed: ${err instanceof Error ? err.message : err}`);
    }
    if (monthly && monthlyFirst && cfg.bots.x.monthlyThread !== false) {
      try {
        const second = threadSecondTweet("month", `${cfg.bots.siteUrl}/month/${prevMonth}`, cfg);
        const r = await postThread(monthlyFirst, second);
        if (r.tweetId) {
          monthly.tweetId = r.tweetId;
          await saveMonthlyDigest(monthly);
          report.notes.push(`month thread posted (${r.tweetId})${r.notes.length > 0 ? `, ${r.notes.join(", ")}` : ""}`);
        } else if (r.notes.length > 0) {
          report.notes.push(`month thread: ${r.notes.join(", ")}`);
        }
      } catch (err) {
        report.notes.push(`month thread failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    state.lastMonthlyDigest = thisMonth;
  }

  // January 1 yearly edition: site-only by decision (no email, cast, or
  // thread), pooled from the year's frozen monthlies. After the monthly
  // block on purpose, so December's fresh freeze is already in the pool.
  const thisYear = today.slice(0, 4);
  if (
    nowUtc.getUTCMonth() === 0 &&
    nowUtc.getUTCDate() === 1 &&
    nowUtc.getUTCHours() >= WEEKLY_SEND_HOUR_UTC &&
    (state.lastYearlyDigest ?? "") !== thisYear
  ) {
    try {
      const prevYear = String(Number(thisYear) - 1);
      const y = await yearlyTop(state, cfg, prevYear);
      if (y) {
        const yearly: YearlyDigest = {
          year: prevYear,
          takenAt: new Date().toISOString(),
          clusters: JSON.parse(JSON.stringify(y.top)) as Cluster[],
          ...(y.episodes.length > 0 ? { episodes: JSON.parse(JSON.stringify(y.episodes)) as MediaItem[] } : {}),
        };
        yearly.contentHash = digestContentHash(yearly);
        await saveYearlyDigest(yearly);
        state.yearlyDigestYears = rememberDate(state.yearlyDigestYears, prevYear);
        report.notes.push(`Yearly digest ${prevYear}: ${yearly.clusters.length} stories frozen`);
      }
    } catch (err) {
      report.notes.push(`Yearly digest freeze failed: ${err instanceof Error ? err.message : err}`);
    }
    state.lastYearlyDigest = thisYear;
  }

  // The current day, week, month, and year as living digests, refreshed
  // every run so their pages and word maps show "so far" at any moment.
  // Runs AFTER the freeze blocks: on a freeze morning the finished edition
  // writes first, then the new period's preview begins.
  try {
    await refreshInProgressDigests(state, cfg);
  } catch (err) {
    report.notes.push(`In-progress refresh failed: ${err instanceof Error ? err.message : err}`);
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
