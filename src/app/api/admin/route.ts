import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, checkPassword, cookieValue, isAdmin, LAYOUT_PREVIEW_COOKIE } from "@/lib/auth";
import { effectiveFeeds, loadFeeds, loadSiteConfig, siteUrl } from "@/lib/config";
import { buildDailyEdition, buildWeeklyEdition, confirmationEmail, recentEpisodes, sendEditionTo, type Edition } from "@/lib/digest";
import { discoverFeed, isMediaFeed, userAgent } from "@/lib/feeds";
import { sendMail } from "@/lib/mail";
import { siteIdentity } from "@/lib/site";
import { classifyAndCluster, heuristicFallback, llmAvailable } from "@/lib/llm";
import { applyEditorOutput, digestClusters, digestPostText, ingestMedia, knownSourceHosts, markSeen, reconsiderFrontSummary, reeditCluster, rejudgeMedia, runPipeline, selectNewItems, takeSnapshot } from "@/lib/pipeline";
import { leadLink } from "@/lib/rank";
import { postTextToX, postToX, XCapError } from "@/lib/social/x";
import { loadDailyDigest, loadState, saveDailyDigest, saveState } from "@/lib/state";
import { sponsoredPlacements } from "@/lib/types";
import type { CandidateItem, Cluster, FeedConfig, Listing, SectionId, SiteState, SponsoredPost } from "@/lib/types";
import { isPrivateHost, newId, normalizeUrl, sha256, slugify, socialSourceName, stripHtml, truncate } from "@/lib/util";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Body = { action: string } & Record<string, unknown>;

function ok(message?: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: true, message, ...extra });
}

function fail(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

// Login attempts: per-instance per-IP cap (same shape as /api/subscribe) plus
// a flat delay on failure. This is the only online barrier to the shared
// password, so the login action gets throttling the other actions don't need.
const loginAttempts = new Map<string, number[]>();
const LOGIN_PER_IP_PER_HOUR = 10;

function loginLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (loginAttempts.get(ip) ?? []).filter((t) => now - t < 60 * 60000);
  if (hits.length >= LOGIN_PER_IP_PER_HOUR) return true;
  hits.push(now);
  loginAttempts.set(ip, hits);
  if (loginAttempts.size > 1000) loginAttempts.clear();
  return false;
}

/**
 * Object lookups on state use attacker-typable keys; a key like __proto__
 * must read as absent, never as the prototype, or one JSON field pollutes
 * every object in the process.
 */
function ownEntry<T>(obj: Record<string, T> | undefined, key: string): T | undefined {
  return obj && Object.hasOwn(obj, key) ? obj[key] : undefined;
}

async function neynar(path: string, method: string, body?: Record<string, unknown>) {
  const key = process.env.NEYNAR_API_KEY;
  if (!key) throw new Error("NEYNAR_API_KEY is not configured.");
  const res = await fetch(`https://api.neynar.com/v2/farcaster${path}`, {
    method,
    headers: { "x-api-key": key, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Neynar ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

/** Normalize placement input (array or legacy single value) to a validated list, or null. */
function parsePlacements(
  raw: unknown,
  cfg: ReturnType<typeof loadSiteConfig>
): SponsoredPost["placements"] | null {
  const values = (Array.isArray(raw) ? raw : raw != null ? [raw] : []).map(String).filter(Boolean);
  const valid = [...new Set(values)].filter(
    (v) => v === "top" || v === "sidebar" || cfg.sections.some((s) => s.id === v)
  );
  // the middle column shows on every story page, so it supersedes any mix
  if (valid.includes("sidebar")) return ["sidebar"];
  return valid.length > 0 ? (valid as SponsoredPost["placements"]) : null;
}

/** Admins paste bare domains all the time; default them to https. */
function ensureHttp(raw: unknown): string {
  const url = String(raw ?? "").trim();
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

async function fetchPageAsItem(url: string): Promise<CandidateItem> {
  let title = url;
  let excerpt = "";
  let publishedAt = new Date().toISOString();
  try {
    if (isPrivateHost(new URL(url).hostname)) throw new Error("private host");
    const res = await fetch(url, {
      headers: { "user-agent": userAgent() },
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });
    const html = await res.text();
    title = stripHtml(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? url);
    const metaDesc =
      /<meta[^>]+(?:name="description"|property="og:description")[^>]+content="([^"]*)"/i.exec(html)?.[1] ?? "";
    excerpt = truncate(`${stripHtml(metaDesc)} ${stripHtml(html).slice(0, 2000)}`.trim(), 1500);
    // the page's own publish date beats fetch time: without it a re-added
    // old article wears a NEW badge and ranks as if it broke just now
    const rawDate =
      /<meta[^>]+(?:property|name)="article:published_time"[^>]+content="([^"]*)"/i.exec(html)?.[1] ??
      /<time[^>]+datetime="([^"]*)"/i.exec(html)?.[1];
    if (rawDate) {
      const d = new Date(rawDate);
      if (Number.isFinite(d.getTime()) && d.getTime() < Date.now()) publishedAt = d.toISOString();
    }
  } catch {
    // Unreachable pages (e.g. tweet links behind JS walls) still get injected;
    // the LLM works from the URL alone in that case.
  }
  return {
    url,
    title: truncate(title, 300),
    publishedAt,
    excerpt,
    sourceId: "manual",
    sourceName: "Added by editor",
    tier: 1,
    weight: 1.5,
  };
}

/**
 * Editor-in-chief override: attach a link straight onto a story, no editorial
 * gate. Exists because the gate judges items as standalone stories, and a
 * link that only makes sense as coverage of an existing story (an angle, a
 * follow-on report) can be correctly rejected standalone yet belong here.
 */
async function attachLinkToCluster(
  state: SiteState,
  cluster: Cluster,
  rawUrl: string,
  as_: "auto" | "lead" | "coverage" = "auto"
): Promise<string> {
  const url = ensureHttp(rawUrl);
  if (!url) return "Paste a link to attach.";
  const social = socialSourceName(url);
  const existing = cluster.links.find((l) => l.url === url);
  if (existing) {
    // re-attaching an existing URL refreshes its attribution (social handle
    // or whitelisted source name, on the link and its stream item alike),
    // repairs a wrong publish stamp, and applies the lead choice
    const knownHost = knownSourceHosts(state).get(new URL(url).hostname.replace(/^www\./, ""));
    const fresh: Record<string, string> = social
      ? { sourceName: social }
      : knownHost
        ? { sourceId: knownHost.sourceId, sourceName: knownHost.sourceName }
        : {};
    const refetched = await fetchPageAsItem(url);
    if (new Date(refetched.publishedAt).getTime() < Date.now() - 60 * 60000) {
      fresh.publishedAt = refetched.publishedAt;
    }
    if (Object.keys(fresh).length > 0) {
      Object.assign(existing, fresh);
      for (const i of state.items) {
        if (normalizeUrl(i.url) === normalizeUrl(url)) Object.assign(i, fresh);
      }
    }
    if (as_ === "lead") cluster.leadUrl = url;
    return Object.keys(fresh).length > 0 ? "Already on this story. Refreshed its attribution." : "That link is already on this story.";
  }
  const page = await fetchPageAsItem(url);
  const host = new URL(url).hostname.replace(/^www\./, "");
  const known = knownSourceHosts(state).get(host);
  const item = {
    ...page,
    id: newId(),
    ...(social
      ? { sourceName: social }
      : known
        ? { sourceId: known.sourceId, sourceName: known.sourceName }
        : { sourceName: host }),
  };
  const now = new Date().toISOString();
  // "coverage" must never take over the kicker: pin the current automatic
  // lead before this link joins and could outrank it
  if (as_ === "coverage" && !cluster.leadUrl && cluster.links.length > 0) cluster.leadUrl = leadLink(cluster).url;
  cluster.links.push({
    url,
    title: item.title,
    sourceId: item.sourceId,
    sourceName: item.sourceName,
    tier: item.tier,
    weight: item.weight,
    publishedAt: item.publishedAt,
    addedAt: now,
  });
  cluster.updatedAt = now;
  markSeen(state, item);
  state.items.unshift({
    id: item.id,
    url,
    title: item.title,
    sourceId: item.sourceId,
    sourceName: item.sourceName,
    tier: item.tier,
    publishedAt: item.publishedAt,
    ingestedAt: now,
    ...(item.excerpt ? { excerpt: item.excerpt } : {}),
    clusterId: cluster.id,
  });
  if (as_ === "lead") cluster.leadUrl = url;
  return `Attached ${item.sourceName}${as_ === "lead" ? " as the lead" : ""} to “${truncate(cluster.headline, 60)}”. No editorial gate applied.`;
}

async function addByUrl(state: SiteState, url: string): Promise<string> {
  const page = await fetchPageAsItem(url);
  // An admin pasting a URL is the override: a prior seen mark (an old gate
  // rejection, or a batch an LLM outage swallowed) must not block a
  // deliberate re-add. Only a link already in the stream is a true duplicate.
  const normalized = normalizeUrl(page.url);
  if (state.items.some((i) => normalizeUrl(i.url) === normalized)) return "Already in the stream (duplicate URL).";
  delete state.seen[sha256(`url:${normalized}`)];
  // credit the real source when the host is one we know, same as Attach
  const host = new URL(page.url).hostname.replace(/^www\./, "");
  const known = knownSourceHosts(state).get(host);
  if (known) {
    page.sourceId = known.sourceId;
    page.sourceName = known.sourceName;
  }
  const candidates = selectNewItems(state, [page]);
  if (candidates.length === 0) return "Already in the stream (duplicate URL).";
  const out = llmAvailable()
    ? await classifyAndCluster(candidates, digestClusters(state, loadSiteConfig().ingest), "add-by-url")
    : heuristicFallback(candidates);
  const applied = applyEditorOutput(state, candidates, out);
  if (applied.touched.size === 0) return "The editor rejected this URL (no usable news content found).";
  await takeSnapshot(state);
  const guard = applied.guardNotes.length > 0 ? ` ${applied.guardNotes.join(" ")}` : "";
  return `Added and clustered (${applied.clustersCreated ? "new story" : "joined existing story"}).${guard}`;
}

export async function POST(req: NextRequest) {
  try {
    return await handle(req);
  } catch (err) {
    // Surface the real reason in the admin toast instead of a generic 500.
    const message = err instanceof Error ? err.message : String(err);
    return fail(`Action failed: ${message}`, 500);
  }
}

async function handle(req: NextRequest) {
  // sameSite=lax already blocks cross-site POSTs; this keeps the API closed
  // even if a fork loosens the cookie settings
  const origin = req.headers.get("origin");
  if (origin && URL.parse(origin)?.host !== req.nextUrl.host) return fail("Cross-origin request refused.", 403);

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.action) return fail("Missing action.");

  if (body.action === "login") {
    const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
    if (loginLimited(ip)) return fail("Too many attempts. Try again later.", 429);
    if (!checkPassword(String(body.password ?? ""))) {
      await new Promise((r) => setTimeout(r, 500));
      return fail("Wrong password.", 401);
    }
    const res = ok("Logged in.");
    res.cookies.set(ADMIN_COOKIE, cookieValue(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
    // cosmetic marker so the footer can show the Admin link in this browser.
    // Readable from JS by design, grants nothing, and deliberately survives
    // logout (a year long, never cleared): the link then just leads to the
    // login form.
    res.cookies.set("oa_admin_ui", "1", {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
    return res;
  }

  if (!(await isAdmin())) return fail("Not authenticated.", 401);

  if (body.action === "logout") {
    const res = ok("Logged out.");
    res.cookies.delete(ADMIN_COOKIE);
    // oa_admin_ui stays on purpose: the footer link persists and leads to the login form
    return res;
  }

  if (body.action === "setLayoutPreview") {
    // forces weekday/weekend rendering in THIS browser only, via a cookie the
    // front page honors only for authenticated admins
    const mode = String(body.mode ?? "");
    if (mode === "weekday" || mode === "weekend") {
      const res = ok(`Previewing the ${mode} layout in this browser. Visitors are unaffected.`);
      res.cookies.set(LAYOUT_PREVIEW_COOKIE, mode, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24,
        path: "/",
      });
      return res;
    }
    const res = ok("Preview cleared. You see what visitors see.");
    res.cookies.delete(LAYOUT_PREVIEW_COOKIE);
    return res;
  }

  if (body.action === "fcCast") {
    const text = String(body.text ?? "").trim();
    if (!text) return fail("Cast text is required.");
    const signer = process.env.FARCASTER_SIGNER_UUID;
    if (!signer) return fail("FARCASTER_SIGNER_UUID is not configured.");
    const parent = String(body.parent ?? "").trim();
    const res = await neynar("/cast", "POST", {
      signer_uuid: signer,
      text,
      ...(parent ? { parent } : {}),
    });
    const hash = res?.cast?.hash as string | undefined;
    const handle = siteIdentity().social?.farcasterHandle;
    return ok(
      parent ? "Reply posted." : "Cast posted.",
      hash && handle ? { url: `https://farcaster.xyz/${handle}/${hash.slice(0, 10)}` } : {}
    );
  }

  if (body.action === "fcDelete") {
    const signer = process.env.FARCASTER_SIGNER_UUID;
    if (!signer) return fail("FARCASTER_SIGNER_UUID is not configured.");
    await neynar("/cast", "DELETE", { signer_uuid: signer, target_hash: String(body.hash ?? "") });
    return ok("Cast deleted.");
  }

  if (body.action === "fcLike") {
    const signer = process.env.FARCASTER_SIGNER_UUID;
    if (!signer) return fail("FARCASTER_SIGNER_UUID is not configured.");
    await neynar("/reaction", "POST", {
      signer_uuid: signer,
      reaction_type: "like",
      target: String(body.hash ?? ""),
    });
    return ok("Liked.");
  }

  if (body.action === "tweetDigest") {
    // hand-retry for a digest whose nightly tweet failed or dry-ran
    const date = String(body.date ?? "");
    const digest = await loadDailyDigest(date);
    if (!digest) return fail("No digest for that date.");
    if (digest.tweetId) return fail("That digest already has an X post.");
    if (digest.clusters.length === 0) return fail("That digest has no stories.");
    const t = await postTextToX(digestPostText(digest, loadSiteConfig().bots.siteUrl));
    if (t.dryRun) return ok("Dry-run: no X credentials configured, nothing posted.");
    if (!t.id) return fail("X accepted the post but returned no id. Check the account before retrying.");
    digest.tweetId = t.id;
    await saveDailyDigest(digest);
    return ok(`Tweeted the ${date} digest.`);
  }

  if (body.action === "runPipeline") {
    const report = await runPipeline();
    return ok(
      `Run complete: ${report.newItems} new items, ${report.clustersCreated} new stories, ${report.feedErrors.length} feed errors.`,
      { report }
    );
  }

  // fresh: admin actions save state, and saving a stale fallback would roll the site back
  const state = await loadState({ fresh: true });
  const cfg = loadSiteConfig();

  const clusterActions = ["pin", "kill", "merge", "resection", "edit", "postX", "reedit", "split", "attachLink", "setLead"];
  if (clusterActions.includes(body.action)) {
    const cluster = ownEntry(state.clusters, String(body.clusterId ?? ""));
    if (!cluster) return fail("Unknown cluster.");
    let message = "";
    let snapshot = true;

    switch (body.action) {
      case "pin":
        cluster.pinned = !cluster.pinned;
        message = cluster.pinned ? "Pinned." : "Unpinned.";
        break;
      case "kill":
        cluster.killed = !cluster.killed;
        message = cluster.killed ? "Killed. Hidden everywhere. Bots will never post it." : "Restored.";
        break;
      case "merge": {
        const target = state.clusters[String(body.targetId ?? "")];
        if (!target || target.id === cluster.id) return fail("Pick a valid target story to merge into.");
        for (const link of cluster.links) {
          if (!target.links.some((l) => l.url === link.url)) target.links.push(link);
        }
        for (const item of state.items) {
          if (item.clusterId === cluster.id) item.clusterId = target.id;
        }
        cluster.killed = true;
        cluster.mergedInto = target.id;
        target.updatedAt = new Date().toISOString();
        message = `Merged into “${target.headline}”.`;
        break;
      }
      case "resection":
        if (body.alsoIn !== undefined) {
          // the second label: empty clears it; never general, never the primary
          const also = String(body.alsoIn ?? "");
          if (!also) {
            delete cluster.alsoIn;
            message = "Second label cleared.";
          } else {
            if (!cfg.sections.some((s) => s.id === also)) return fail("Unknown section.");
            if (also === cluster.section) return fail("That is already the story's section.");
            cluster.alsoIn = also as SectionId;
            message = `Also listed in ${also}.`;
          }
          break;
        }
        // general is a valid roundup section without a nav entry in cfg.sections
        if (body.section !== "general" && !cfg.sections.some((s) => s.id === body.section)) return fail("Unknown section.");
        cluster.section = body.section as SectionId;
        if (cluster.alsoIn === cluster.section) delete cluster.alsoIn;
        message = `Moved to ${body.section}.`;
        break;
      case "edit":
        if (typeof body.headline === "string" && body.headline.trim() && body.headline.trim() !== cluster.headline) {
          cluster.editHistory = [
            { at: new Date().toISOString(), kind: "manual" as const, before: cluster.headline, after: truncate(body.headline.trim(), 140) },
            ...(cluster.editHistory ?? []),
          ].slice(0, 5);
          cluster.headline = truncate(body.headline.trim(), 140);
          cluster.slug = slugify(cluster.headline, cluster.id);
        }
        if (typeof body.explainer === "string") cluster.explainer = body.explainer.trim();
        cluster.needsReview = false;
        message = "Updated.";
        break;
      case "reedit":
        message = await reeditCluster(state, cluster);
        break;
      case "attachLink": {
        const mode = ["lead", "coverage"].includes(String(body.as)) ? (String(body.as) as "lead" | "coverage") : "auto";
        message = await attachLinkToCluster(state, cluster, String(body.url ?? ""), mode);
        break;
      }
      case "setLead": {
        const url = String(body.url ?? "");
        if (!url) {
          delete cluster.leadUrl;
          message = "Lead returns to automatic.";
          break;
        }
        if (!cluster.links.some((l) => l.url === url)) return fail("That link is not on this story.");
        cluster.leadUrl = url;
        message = "Lead set.";
        break;
      }
      case "split": {
        const urls = new Set(Array.isArray(body.urls) ? body.urls.map(String) : []);
        if (urls.size === 0) return fail("Select at least one link to split out.");
        const moving = cluster.links.filter((l) => urls.has(l.url));
        const staying = cluster.links.filter((l) => !urls.has(l.url));
        if (moving.length === 0) return fail("No matching links.");
        if (staying.length === 0) return fail("You selected every link. Use Re-edit or Kill instead of splitting.");
        const now2 = new Date().toISOString();
        const id = newId();
        const split: typeof cluster = {
          id,
          slug: slugify(moving[0].title, id),
          headline: truncate(moving[0].title, 140),
          explainer: "",
          section: cluster.section,
          links: moving,
          importance: 2,
          keywords: [],
          createdAt: now2,
          updatedAt: now2,
        };
        cluster.links = staying;
        state.clusters[id] = split;
        for (const item of state.items) {
          if (item.clusterId === cluster.id && urls.has(item.url)) item.clusterId = id;
        }
        const a = await reeditCluster(state, cluster);
        const b = await reeditCluster(state, split);
        message = `Split ${moving.length} link${moving.length === 1 ? "" : "s"} into a new story. Original: ${a} New story: ${b}`;
        break;
      }
      case "postX": {
        snapshot = false;
        try {
          const { dryRun } = await postToX(state, cluster, cfg.bots, { manual: true });
          cluster.posted = { ...cluster.posted, x: new Date().toISOString() };
          message = dryRun ? "Dry-run: would have posted to X (no credentials configured)." : "Posted to X.";
        } catch (err) {
          if (err instanceof XCapError) return fail(err.message);
          throw err;
        }
        break;
      }
    }
    cluster.updatedAt = new Date().toISOString();
    // a story change can invalidate a summary line citing it; flag the
    // summary so the next pipeline run reconsiders it
    if (body.action !== "postX" && state.frontSummary?.text) state.frontSummary.stale = true;
    if (snapshot && body.action !== "pin") await takeSnapshot(state);
    await saveState(state);
    return ok(message);
  }

  if (body.action === "refreshSummary") {
    const r = await reconsiderFrontSummary(state, cfg);
    if (r.changed) await takeSnapshot(state);
    await saveState(state);
    return ok(r.note);
  }

  if (body.action === "testDigestEmail") {
    // sends the real edition exactly as a subscriber would receive it: to a
    // named subscriber (with their own working unsubscribe link) or, with no
    // email given, to the admin's own inbox
    let to = process.env.SMTP_USER;
    let unsub: string | undefined;
    if (body.email) {
      const sub = (state.digestSubscribers ?? []).find((s) => s.email === String(body.email));
      if (!sub) return fail("Unknown subscriber.");
      to = sub.email;
      unsub = `${siteUrl()}/api/subscribe?unsub=${sub.token}`;
    }
    if (!to) return fail("SMTP_USER is not configured.");
    let edition: Edition | null;
    if (body.kind === "weekly") {
      edition = await buildWeeklyEdition(state, cfg);
      if (!edition) return fail("Nothing to send: no stories in the last week.");
    } else {
      const date = state.dailyDigestDates?.[0];
      if (!date) return fail("No daily digest exists yet. The first freezes at UTC midnight.");
      const digest = await loadDailyDigest(date);
      if (!digest) return fail(`Could not load the ${date} digest.`);
      edition = buildDailyEdition(digest, recentEpisodes(state, 24, 3));
    }
    const err = await sendEditionTo(to, edition, unsub);
    return err ? fail(`Send failed: ${err}`) : ok(`Test ${body.kind === "weekly" ? "weekly" : "daily"} edition sent to ${to}.`);
  }

  if (body.action === "resendConfirmation") {
    const sub = (state.digestSubscribers ?? []).find((s) => s.email === String(body.email ?? ""));
    if (!sub) return fail("Unknown subscriber.");
    if (sub.confirmed !== false) return fail("Already confirmed, nothing to resend.");
    const c = confirmationEmail(sub.token);
    const err = await sendMail(sub.email, c.subject, c.text, c.html);
    return err ? fail(`Send failed: ${err}`) : ok(`Confirmation email resent to ${sub.email}.`);
  }

  if (body.action === "removeSubscriber") {
    const email = String(body.email ?? "");
    const before = (state.digestSubscribers ?? []).length;
    state.digestSubscribers = (state.digestSubscribers ?? []).filter((s) => s.email !== email);
    if (state.digestSubscribers.length === before) return fail("Unknown subscriber.");
    await saveState(state);
    return ok(`Removed ${email}.`);
  }

  if (body.action === "setWeekendSchedule") {
    if (body.reset) {
      delete state.weekendSchedule;
      await saveState(state);
      return ok("Weekend window reset to the built-in default (Saturday 00:00 until Monday morning UTC).");
    }
    const num = (v: unknown, max: number) => {
      const n = Math.round(Number(v));
      return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
    };
    const startDow = num(body.startDow, 6);
    const startHour = num(body.startHour, 23);
    const endDow = num(body.endDow, 6);
    const endHour = num(body.endHour, 23);
    if (startDow === null || startHour === null || endDow === null || endHour === null) {
      return fail("Days run 0 (Sunday) to 6 (Saturday) and hours 0 to 23.");
    }
    if (startDow === endDow && startHour === endHour) {
      return fail("The window cannot start and end at the same moment.");
    }
    state.weekendSchedule = { startDow, startHour, endDow, endHour };
    await saveState(state);
    return ok("Weekend window saved. It applies immediately, to the pipeline's summaries as well as the page.");
  }

  if (body.action === "dismissCandidate") {
    const host = String(body.host ?? "");
    const cand = ownEntry(state.sourceCandidates, host);
    if (!cand) return fail("Unknown candidate domain.");
    // kept rather than deleted so the same domain cannot reappear next run
    cand.dismissed = true;
    await saveState(state);
    return ok(`Dismissed ${host}.`);
  }

  if (body.action === "addCandidate") {
    const host = String(body.host ?? "");
    const cand = ownEntry(state.sourceCandidates, host);
    if (!cand) return fail("Unknown candidate domain.");
    const o = (state.feedOverrides ??= { custom: [], disabled: [] });
    const found = await discoverFeed(host, cfg.ingest.feedTimeoutMs);
    if (!found) {
      return fail(
        `No feed found on ${host}: not a Discourse forum, no feed link on the homepage, none of the usual feed paths. Add it manually in Sources (possibly as a listing scrape).`
      );
    }
    const name = truncate(stripHtml(found.title ?? ""), 60).trim() || host;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "source";
    if (loadFeeds().some((f) => f.id === id) || o.custom.some((f) => f.id === id)) {
      return fail(`A source with the id “${id}” already exists.`);
    }
    // tier 2 on purpose: a domain discovered through Farcaster chatter faces
    // the gate until a human decides it has earned pass-through
    const feed: FeedConfig = {
      id,
      name,
      url: found.url,
      type: found.type,
      tier: 2,
      weight: 1,
      category: "other",
      added: new Date().toISOString().slice(0, 10),
    };
    o.custom.push(feed);
    cand.dismissed = true; // covered now: it must not resurface as a candidate
    await saveState(state);
    return ok(
      `Source “${name}” added from ${host} (${found.type} feed ${found.url}, tier 2, weight 1). It's polled starting next pipeline run; tune tier, weight, and category in Sources.`
    );
  }

  if (body.action === "addUrl") {
    const url = String(body.url ?? "").trim();
    if (!/^https?:\/\//.test(url)) return fail("Paste a full http(s) URL.");
    const message = await addByUrl(state, url);
    await saveState(state);
    return ok(message);
  }

  if (body.action === "approveSubmission" || body.action === "dismissSubmission") {
    const sub = (state.submissions ?? []).find((s) => s.id === String(body.id ?? ""));
    if (!sub) return fail("Unknown submission.");
    if (sub.status !== "pending") return fail("Already handled.");
    if (body.action === "dismissSubmission") {
      sub.status = "dismissed";
      await saveState(state);
      return ok("Dismissed.");
    }
    // a submission aimed at a specific story attaches straight to it, no
    // editorial gate: the reader already told us where it belongs, and the
    // gate judges standalone stories, not coverage angles
    const target = sub.storySlug
      ? Object.values(state.clusters).find(
          (c) => !c.killed && !c.mergedInto && (c.slug === sub.storySlug || sub.storySlug!.endsWith(c.id))
        )
      : undefined;
    const message = target ? await attachLinkToCluster(state, target, sub.url) : await addByUrl(state, sub.url);
    if (target) await takeSnapshot(state);
    sub.status = "approved";
    await saveState(state);
    return ok(`Approved. ${message}`);
  }

  if (body.action === "setSponsorPage") {
    state.sponsorPageEnabled = Boolean(body.enabled);
    await saveState(state);
    return ok(state.sponsorPageEnabled ? "Sponsor page is live (footer link included)." : "Sponsor page hidden.");
  }

  if (body.action === "setAnnouncement") {
    const text = String(body.text ?? "").trim();
    const url = ensureHttp(body.url);
    state.announcement = text ? { text: truncate(text, 200), ...(url ? { url } : {}) } : null;
    await saveState(state);
    return ok(text ? "Announcement live." : "Announcement cleared. Placeholder restored.");
  }

  if (body.action === "addSponsored") {
    const headline = String(body.headline ?? "").trim();
    const url = ensureHttp(body.url);
    if (!headline || !url) return fail("Headline and URL are required.");
    const placements = parsePlacements(body.placements ?? body.placement, cfg);
    if (!placements) return fail("Pick at least one valid placement.");
    const queued = (state.sponsoredPosts ?? []).some(
      (p) => !p.hidden && sponsoredPlacements(p).some((pl) => placements.includes(pl))
    );
    const post: SponsoredPost = {
      id: newId(),
      headline: truncate(headline, 140),
      url,
      sponsor: body.sponsor ? String(body.sponsor) : undefined,
      description: String(body.description ?? "").trim() ? truncate(String(body.description).trim(), 280) : undefined,
      placements,
      ...(queued ? { hidden: true } : {}),
      addedAt: new Date().toISOString(),
    };
    state.sponsoredPosts = [...(state.sponsoredPosts ?? []), post];
    await saveState(state);
    return ok(
      queued
        ? `Added as hidden: a visible post already covers ${placements.join("/")}. Toggle “shown” to swap them.`
        : `Sponsored post live in ${placements.join(", ")}.`
    );
  }

  if (body.action === "toggleShown") {
    const kind = String(body.kind);
    const id = String(body.id ?? "");
    if (kind === "sponsoredPosts") {
      const p = (state.sponsoredPosts ?? []).find((x) => x.id === id);
      if (!p) return fail("Unknown sponsored post.");
      p.hidden = !p.hidden;
      await saveState(state);
      return ok(p.hidden ? "Hidden from the site (kept here for later)." : "Now shown on the site.");
    }
    const listKind = (["jobs", "events", "podcasts"] as const).find((k) => k === kind);
    if (!listKind) return fail("Unknown list.");
    const l = (state[listKind] ?? []).find((x) => x.id === id);
    if (!l) return fail("Unknown listing.");
    l.hidden = !l.hidden;
    await saveState(state);
    return ok(l.hidden ? "Hidden from the site (kept here for later)." : "Now shown on the site.");
  }

  if (body.action === "refreshMedia") {
    // media-only ingest: fetch + gate + shelve, nothing from the news flow.
    // The button exists so a fresh deploy (or a new show) fills the shelf
    // without waiting for the hourly cadence.
    const mediaFeeds = effectiveFeeds(state).filter(isMediaFeed);
    if (mediaFeeds.length === 0) return fail("No media feeds configured.");
    const res = await ingestMedia(state, mediaFeeds, cfg);
    state.lastMediaIngestAt = new Date().toISOString();
    await saveState(state);
    const errs = res.errors.length > 0 ? ` Feed errors: ${res.errors.map((e) => e.feedId).join(", ")}.` : "";
    return ok(`${res.note ?? "Media shelf refreshed, nothing new."}${errs}`);
  }

  if (body.action === "rejudgeMedia") {
    // the gate prompt changed: apply it to what is already shelved
    const mediaFeeds = effectiveFeeds(state).filter(isMediaFeed);
    const r = await rejudgeMedia(state, mediaFeeds, cfg.ingest.feedTimeoutMs);
    await saveState(state);
    return ok(r.note);
  }

  if (body.action === "setMediaTitle") {
    // a site title for the rare episode whose own title misleads; empty clears it
    const m = (state.mediaItems ?? []).find((x) => x.id === body.id);
    if (!m) return fail("Unknown media item.");
    const t = String(body.title ?? "").trim();
    if (t) m.displayTitle = t.slice(0, 200);
    else delete m.displayTitle;
    await saveState(state);
    return ok(t ? "Site title set. The show's own title stays in the tooltip and on the watch link." : "Site title cleared.");
  }

  if (body.action === "toggleMediaHidden") {
    const m = (state.mediaItems ?? []).find((x) => x.id === body.id);
    if (!m) return fail("Unknown media item.");
    m.hidden = !m.hidden;
    await saveState(state);
    return ok(m.hidden ? "Hidden from the site (kept here until it ages out)." : "Now shown on the site.");
  }

  if (body.action === "toggleAnnouncement") {
    if (!state.announcement?.text) return fail("No announcement saved.");
    state.announcement.hidden = !state.announcement.hidden;
    await saveState(state);
    return ok(state.announcement.hidden ? "Announcement hidden (text kept)." : "Announcement shown.");
  }

  if (body.action === "removeSponsored") {
    state.sponsoredPosts = (state.sponsoredPosts ?? []).filter((p) => p.id !== body.id);
    await saveState(state);
    return ok("Sponsored post removed.");
  }

  if (body.action === "editSponsored") {
    const p = (state.sponsoredPosts ?? []).find((x) => x.id === body.id);
    if (!p) return fail("Unknown sponsored post.");
    const headline = String(body.headline ?? "").trim();
    if (headline) p.headline = truncate(headline, 140);
    const url = ensureHttp(body.url);
    if (url) p.url = url;
    p.sponsor = String(body.sponsor ?? "").trim() || undefined;
    p.description = String(body.description ?? "").trim() ? truncate(String(body.description).trim(), 280) : undefined;
    const placements = parsePlacements(body.placements ?? body.placement, cfg);
    if (placements) {
      p.placements = placements;
      delete p.placement; // normalize away the legacy field
    }
    await saveState(state);
    return ok("Sponsored post updated.");
  }

  if (body.action === "editListing") {
    const kind = (["jobs", "events", "podcasts"] as const).find((k) => k === body.kind);
    if (!kind) return fail("Unknown list.");
    const l = (state[kind] ?? []).find((x) => x.id === body.id);
    if (!l) return fail("Unknown listing.");
    const title = String(body.title ?? "").trim();
    if (title) l.title = title;
    const url = ensureHttp(body.url);
    if (url) l.url = url;
    l.org = String(body.org ?? "").trim() || undefined;
    l.date = String(body.date ?? "").trim() || undefined;
    await saveState(state);
    return ok("Listing updated.");
  }

  if (["addFeed", "removeFeed", "toggleFeed", "editFeed"].includes(body.action)) {
    const o = (state.feedOverrides ??= { custom: [], disabled: [] });
    if (body.action === "addFeed") {
      const name = String(body.name ?? "").trim();
      const url = ensureHttp(body.url);
      if (!name || !url) return fail("Source name and feed URL are required.");
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "source";
      if (loadFeeds().some((f) => f.id === id) || o.custom.some((f) => f.id === id)) {
        return fail(`A source with the id “${id}” already exists.`);
      }
      const tier = String(body.tier) === "2" ? 2 : 1;
      const weight = Math.max(0.1, Math.min(5, Number(body.weight) || (tier === 1 ? 2 : 1)));
      const type = body.type === "discourse" ? "discourse" : "rss";
      const sectionHint = cfg.sections.some((s) => s.id === body.sectionHint)
        ? (body.sectionHint as SectionId)
        : undefined;
      const category = String(body.category ?? "other").slice(0, 24);
      const feed: FeedConfig = {
        id,
        name,
        url,
        type,
        tier,
        weight,
        category,
        added: new Date().toISOString().slice(0, 10),
        ...(sectionHint ? { sectionHint } : {}),
      };
      o.custom.push(feed);
      await saveState(state);
      return ok(`Source “${name}” added (tier ${tier}, weight ${weight}). It's polled starting next pipeline run.`);
    }
    const id = String(body.id ?? "");
    if (body.action === "removeFeed") {
      if (!o.custom.some((f) => f.id === id)) return fail("Only admin-added sources can be removed. Built-in ones can be disabled.");
      o.custom = o.custom.filter((f) => f.id !== id);
      o.disabled = o.disabled.filter((d) => d !== id);
      await saveState(state);
      return ok("Source removed.");
    }
    if (![...loadFeeds(), ...o.custom].some((f) => f.id === id)) return fail("Unknown source.");
    if (body.action === "editFeed") {
      const edit: { tier?: 1 | 2; weight?: number; category?: string; thumbStyle?: "episode" | "frame" | "frame2" | "frame3" | "show" } = {};
      if (body.tier !== undefined) edit.tier = String(body.tier) === "2" ? 2 : 1;
      if (body.weight !== undefined) {
        const w = Number(body.weight);
        if (!Number.isFinite(w)) return fail("Weight must be a number.");
        edit.weight = Math.max(0.1, Math.min(5, w));
      }
      if (body.category !== undefined) edit.category = String(body.category).slice(0, 24);
      if (body.thumbStyle !== undefined && ["episode", "frame", "frame2", "frame3", "show"].includes(String(body.thumbStyle))) {
        edit.thumbStyle = String(body.thumbStyle) as "episode" | "frame" | "frame2" | "frame3" | "show";
      }
      o.edits = { ...(o.edits ?? {}), [id]: { ...(o.edits?.[id] ?? {}), ...edit } };
      await saveState(state);
      return ok("Source updated. Applies from the next pipeline run (existing story scores update immediately).");
    }
    // toggleFeed
    const disabled = o.disabled.includes(id);
    o.disabled = disabled ? o.disabled.filter((d) => d !== id) : [...o.disabled, id];
    await saveState(state);
    return ok(disabled ? "Source re-enabled. Polled from the next run." : "Source disabled. It will no longer be polled.");
  }

  if (["addMarket", "removeMarket", "toggleMarket"].includes(body.action)) {
    const cfgMarkets = cfg.polymarket?.markets ?? [];
    const o = (state.marketOverrides ??= { custom: [], disabled: [] });
    if (body.action === "addMarket") {
      // admins paste market URLs all the time; accept a full polymarket.com
      // URL or a bare slug (the market URL's last path segment)
      const raw = String(body.slug ?? "").trim();
      const slug = (raw.includes("/") ? raw.replace(/[?#].*$/, "").split("/").filter(Boolean).pop() ?? "" : raw).toLowerCase();
      const label = String(body.label ?? "").trim();
      if (!/^[a-z0-9-]+$/.test(slug)) return fail("That doesn't look like a market. Paste the polymarket.com market URL or its slug.");
      if (!label) return fail("A label is required: it becomes the headline's subject (e.g. “the treaty being ratified in 2026”).");
      if ([...cfgMarkets, ...o.custom].some((m) => m.slug === slug)) return fail("That market is already configured.");
      const section = cfg.sections.some((s) => s.id === body.section) ? (body.section as SectionId) : undefined;
      o.custom.push({ slug, label: truncate(label, 90), ...(section ? { section } : {}) });
      o.disabled = o.disabled.filter((d) => d !== slug);
      await saveState(state);
      return ok(
        `Market “${label}” added. It's polled from the next pipeline run; if Polymarket reports no 24h change for it, swing detection starts once a ~24h baseline exists.`
      );
    }
    const slug = String(body.slug ?? "");
    if (body.action === "removeMarket") {
      if (!o.custom.some((m) => m.slug === slug)) return fail("Only admin-added markets can be removed. Built-in ones can be disabled.");
      o.custom = o.custom.filter((m) => m.slug !== slug);
      o.disabled = o.disabled.filter((d) => d !== slug);
      await saveState(state);
      return ok("Market removed.");
    }
    // toggleMarket
    if (![...cfgMarkets, ...o.custom].some((m) => m.slug === slug)) return fail("Unknown market.");
    const disabled = o.disabled.includes(slug);
    o.disabled = disabled ? o.disabled.filter((d) => d !== slug) : [...o.disabled, slug];
    await saveState(state);
    return ok(disabled ? "Market re-enabled. Polled from the next run." : "Market disabled. It will no longer be polled.");
  }

  if (body.action === "addListing" || body.action === "removeListing" || body.action === "toggleFeatured") {
    const kind = (["jobs", "events", "podcasts"] as const).find((k) => k === body.kind) ?? "jobs";
    const list = state[kind] ?? (state[kind] = []);
    if (body.action === "addListing") {
      if (!body.title || !body.url) return fail("Title and URL are required.");
      const listing: Listing = {
        id: newId(),
        title: String(body.title),
        url: ensureHttp(body.url),
        org: body.org ? String(body.org) : undefined,
        location: body.location ? String(body.location) : undefined,
        date: body.date ? String(body.date) : undefined,
        featured: Boolean(body.featured),
        paid: Boolean(body.paid),
        addedAt: new Date().toISOString(),
      };
      list.unshift(listing);
    } else {
      const listing = list.find((l) => l.id === body.id);
      if (!listing) return fail("Unknown listing.");
      if (body.action === "removeListing") list.splice(list.indexOf(listing), 1);
      else listing.featured = !listing.featured;
    }
    await saveState(state);
    return ok("Saved.");
  }

  return fail(`Unknown action: ${body.action}`);
}
