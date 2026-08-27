import { NextRequest, NextResponse } from "next/server";
import { confirmationEmail } from "@/lib/digest";
import { sendMail } from "@/lib/mail";
import { loadState, saveState } from "@/lib/state";
import type { DigestSubscriber } from "@/lib/types";
import { newId } from "@/lib/util";

export const dynamic = "force-dynamic";

const MAX_SUBSCRIBERS = 5000;
const PER_IP_PER_HOUR = 5;

// Per-instance rate limit, same shape as /api/suggest: imperfect across
// serverless instances but enough, with the honeypot, to keep abuse out.
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
    email?: string;
    daily?: boolean;
    weekly?: boolean;
    monthly?: boolean;
    website?: string; // honeypot: real users never see or fill this field
  } | null;
  if (!body) return NextResponse.json({ ok: false, message: "Bad request." }, { status: 400 });
  if (body.website) return NextResponse.json({ ok: true, message: "You're signed up. See you in the next edition." });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ ok: false, message: "Too many signups from this address. Try again later." }, { status: 429 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return NextResponse.json({ ok: false, message: "That doesn't look like an email address." }, { status: 400 });
  }
  const daily = Boolean(body.daily);
  const weekly = Boolean(body.weekly);
  const monthly = Boolean(body.monthly);
  if (!daily && !weekly && !monthly) {
    return NextResponse.json({ ok: false, message: "Pick at least one edition." }, { status: 400 });
  }

  // fresh: this route saves state, and saving a stale fallback would roll the site back
  const state = await loadState({ fresh: true });
  const subs = (state.digestSubscribers ??= []);
  const existing = subs.find((s) => s.email === email);
  if (existing) {
    existing.daily = daily;
    existing.weekly = weekly;
    existing.monthly = monthly;
    await saveState(state);
    if (existing.confirmed === false) {
      // still unconfirmed: a re-signup is the natural "resend the link" gesture
      const c = confirmationEmail(existing.token);
      const resendErr = await sendMail(email, c.subject, c.text, c.html);
      if (resendErr) {
        console.error(`[subscribe] confirmation resend failed for ${email}: ${resendErr}`);
        return NextResponse.json({ ok: false, message: `The confirmation email failed to send: ${resendErr}` });
      }
      return NextResponse.json({ ok: true, message: "Almost done: click the confirmation link we just emailed you." });
    }
    return NextResponse.json({ ok: true, message: "Preferences updated. See you in the next edition." });
  }
  if (subs.length >= MAX_SUBSCRIBERS) {
    return NextResponse.json({ ok: false, message: "Signups are closed for the moment." }, { status: 503 });
  }
  const sub: DigestSubscriber = {
    email,
    daily,
    weekly,
    monthly,
    token: `${newId()}${newId()}`,
    addedAt: new Date().toISOString(),
    // nothing sends until the confirmation link is clicked, so a stranger's
    // address can never be signed up for them
    confirmed: false,
  };
  subs.push(sub);
  await saveState(state);
  const c = confirmationEmail(sub.token);
  const sendErr = await sendMail(email, c.subject, c.text, c.html);
  if (sendErr) {
    console.error(`[subscribe] confirmation email failed for ${email}: ${sendErr}`);
    return NextResponse.json({
      ok: false,
      message: "Signed up, but the confirmation email failed to send. Submit again in a minute to retry.",
    });
  }
  return NextResponse.json({ ok: true, message: "Almost done: click the confirmation link we just emailed you." });
}

/** Confirmation and unsubscribe targets for the links the emails carry. */
export async function GET(req: NextRequest) {
  const confirm = req.nextUrl.searchParams.get("confirm");
  if (confirm) {
    const state = await loadState({ fresh: true });
    const sub = (state.digestSubscribers ?? []).find((s) => s.token === confirm);
    if (sub && sub.confirmed === false) {
      sub.confirmed = true;
      await saveState(state);
    }
    // an already-confirmed or unknown token lands on the same page: from the
    // clicker's side the outcome ("you're set") is identical
    return NextResponse.redirect(new URL("/subscribe?confirmed=1", req.url));
  }

  const token = req.nextUrl.searchParams.get("unsub");
  if (!token) return NextResponse.redirect(new URL("/subscribe", req.url));
  const state = await loadState({ fresh: true });
  const subs = state.digestSubscribers ?? [];
  const idx = subs.findIndex((s) => s.token === token);
  if (idx >= 0) {
    subs.splice(idx, 1);
    await saveState(state);
  }
  // an unknown token still lands on the confirmation: the address is gone either way
  return NextResponse.redirect(new URL("/subscribe?unsubscribed=1", req.url));
}
