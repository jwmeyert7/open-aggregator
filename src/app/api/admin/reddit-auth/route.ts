import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { siteUrl } from "@/lib/config";
import { siteIdentity } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * One-time helper to mint the Reddit refresh token the daily comment posts
 * with. Admin only. Visiting it sends you to Reddit's consent screen for the
 * app in REDDIT_CLIENT_ID; Reddit sends you back here with a code, which is
 * traded for a permanent refresh token and shown once, to paste into the
 * Vercel env as REDDIT_REFRESH_TOKEN. Nothing is stored server-side. The
 * app's redirect URI on reddit.com/prefs/apps must be exactly this route's
 * URL on the live site.
 */
export async function GET(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) {
    return NextResponse.json({ error: "REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET must be set in the env first" }, { status: 400 });
  }
  const redirect = `${siteUrl()}/api/admin/reddit-auth`;
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get("reddit_auth_state")?.value;

  if (!code) {
    // step one: off to Reddit, with a nonce so the callback is ours
    const nonce = crypto.randomBytes(16).toString("hex");
    const url = new URL("https://www.reddit.com/api/v1/authorize");
    url.searchParams.set("client_id", id);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", nonce);
    url.searchParams.set("redirect_uri", redirect);
    url.searchParams.set("duration", "permanent");
    url.searchParams.set("scope", "identity read submit");
    const res = NextResponse.redirect(url.toString());
    res.cookies.set("reddit_auth_state", nonce, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/admin/reddit-auth" });
    return res;
  }

  if (!state || state !== cookieState) return NextResponse.json({ error: "state mismatch, start over at /api/admin/reddit-auth" }, { status: 400 });
  const tokenRes = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": `web:${siteIdentity().domain}:v1.0 (auth helper)`,
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect }),
  });
  const json = (await tokenRes.json().catch(() => ({}))) as { refresh_token?: string; error?: string; scope?: string };
  if (!tokenRes.ok || !json.refresh_token) {
    return NextResponse.json({ error: `Reddit did not return a refresh token: ${json.error ?? tokenRes.status}` }, { status: 502 });
  }
  const res = new NextResponse(
    [
      "Reddit refresh token minted. Add it to the Vercel env as REDDIT_REFRESH_TOKEN (production), then redeploy.",
      "",
      json.refresh_token,
      "",
      `Scopes: ${json.scope ?? "?"}. This page is the only place the token is shown. Close it when done.`,
    ].join("\n"),
    { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } }
  );
  res.cookies.delete("reddit_auth_state");
  return res;
}
