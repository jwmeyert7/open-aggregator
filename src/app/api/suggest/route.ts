import { NextRequest, NextResponse } from "next/server";
import { effectiveFeeds, siteUrl } from "@/lib/config";
import { sendAdminEmail } from "@/lib/mail";
import { siteIdentity } from "@/lib/site";
import { loadState, saveState } from "@/lib/state";
import type { Submission } from "@/lib/types";
import { newId, normalizeUrl, sha256 } from "@/lib/util";

export const dynamic = "force-dynamic";

const MAX_PENDING = 50;
const PER_IP_PER_HOUR = 5;

// Per-instance rate limit: imperfect across serverless instances, but paired
// with the honeypot and the pending cap it keeps the queue abuse-resistant.
const recent = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < 60 * 60000);
  if (hits.length >= PER_IP_PER_HOUR) return true;
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 1000) recent.clear();
  return false;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    url?: string;
    note?: string;
    email?: string;
    story?: string;
    website?: string; // honeypot: real users never see or fill this field
  } | null;
  if (!body) return NextResponse.json({ ok: false, message: "Bad request." }, { status: 400 });

  // Bots that fill every field get a quiet success and no queue entry.
  if (body.website) return NextResponse.json({ ok: true, message: "Thanks! Your suggestion is in the queue." });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ ok: false, message: "Too many suggestions from this address. Try again later." }, { status: 429 });
  }

  let url: URL;
  try {
    url = new URL(String(body.url ?? "").trim());
    if (!/^https?:$/.test(url.protocol)) throw new Error();
  } catch {
    return NextResponse.json({ ok: false, message: "That doesn't look like a valid link." }, { status: 400 });
  }

  // fresh: this route saves state, and saving a stale fallback would roll the site back
  const state = await loadState({ fresh: true });
  const submissions = state.submissions ?? [];
  const pending = submissions.filter((s) => s.status === "pending");
  if (pending.length >= MAX_PENDING) {
    return NextResponse.json({ ok: false, message: "The suggestion queue is full right now. Try again later." }, { status: 429 });
  }
  const normalized = normalizeUrl(url.href);
  if (
    pending.some((s) => normalizeUrl(s.url) === normalized) ||
    state.seen[sha256(`url:${normalized}`)] ||
    state.items.some((i) => normalizeUrl(i.url) === normalized)
  ) {
    return NextResponse.json({ ok: true, message: "We already have that link. Thanks for looking out!" });
  }

  const knownHosts = new Set(effectiveFeeds(state).map((f) => new URL(f.url).hostname.replace(/^www\./, "")));
  const storySlug = String(body.story ?? "").trim() || undefined;
  const submission: Submission = {
    id: newId(),
    url: url.href,
    note: String(body.note ?? "").trim().slice(0, 500) || undefined,
    email: String(body.email ?? "").trim().slice(0, 200) || undefined,
    ...(storySlug ? { storySlug } : {}),
    newSource: !knownHosts.has(url.hostname.replace(/^www\./, "")),
    at: new Date().toISOString(),
    status: "pending",
  };
  state.submissions = [submission, ...submissions];
  await saveState(state);

  const story = storySlug ? Object.values(state.clusters).find((c) => c.slug === storySlug) : undefined;
  await sendAdminEmail(
    `[${siteIdentity().siteName}] link suggestion${submission.newSource ? " (new source!)" : ""}`,
    [
      submission.url,
      story ? `For story: ${story.headline}\n${siteUrl()}/story/${story.slug}` : "Suggested as a new story.",
      submission.note ? `Note: ${submission.note}` : "",
      submission.email ? `From: ${submission.email}` : "",
      submission.newSource ? "This domain is not one of your sources." : "",
      "",
      `Review: ${siteUrl()}/admin#submissions`,
    ]
      .filter(Boolean)
      .join("\n")
  );

  return NextResponse.json({ ok: true, message: "Thanks! Your suggestion is in the queue." });
}
