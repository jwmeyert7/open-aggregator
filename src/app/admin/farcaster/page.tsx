import { FarcasterClient, type FcCast, type FcNotification } from "./FarcasterClient";
import { buildChrome, NotLoggedIn } from "../server";
import { AdminChrome } from "../shared";
import { isAdmin } from "@/lib/auth";
import { loadSiteConfig } from "@/lib/config";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

export const metadata = { title: "Farcaster", robots: { index: false } };

async function neynarGet(path: string): Promise<Record<string, unknown> | null> {
  const key = process.env.NEYNAR_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`https://api.neynar.com/v2/farcaster${path}`, {
      headers: { "x-api-key": key },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export default async function FarcasterPage() {
  if (!(await isAdmin())) return <NotLoggedIn />;
  const chrome = buildChrome(await loadState(), loadSiteConfig());

  if (!process.env.NEYNAR_API_KEY || !process.env.FARCASTER_SIGNER_UUID) {
    return (
      <main className="wrap page single admin">
        <div>
          <AdminChrome chrome={chrome} />
          <p className="status-line">Farcaster credentials are not configured in this environment.</p>
        </div>
      </main>
    );
  }

  // resolve our fid from the signer, and the account's username from the fid
  const signerInfo = await neynarGet(`/signer?signer_uuid=${process.env.FARCASTER_SIGNER_UUID}`);
  const fid = (signerInfo?.fid as number) ?? null;
  let username: string | null = null;

  let casts: FcCast[] = [];
  let notifications: FcNotification[] = [];

  if (fid) {
    const userRes = await neynarGet(`/user/bulk?fids=${fid}`);
    username = ((userRes?.users as Array<{ username?: string }>) ?? [])[0]?.username ?? null;

    const castsRes = await neynarGet(`/feed/user/casts?fid=${fid}&limit=25&include_replies=true`);
    const rawCasts = (castsRes?.casts as Array<Record<string, any>>) ?? [];
    casts = rawCasts.map((c) => ({
      hash: c.hash,
      text: c.text ?? "",
      timestamp: c.timestamp ?? "",
      likes: c.reactions?.likes_count ?? c.reactions?.likes?.length ?? 0,
      replies: c.replies?.count ?? 0,
    }));

    const notifRes = await neynarGet(`/notifications?fid=${fid}&limit=25`);
    const rawNotifs = (notifRes?.notifications as Array<Record<string, any>>) ?? [];
    notifications = rawNotifs
      .filter((n) => ["mention", "mentions", "reply", "replies", "quote"].includes(String(n.type)))
      .map((n) => ({
        type: String(n.type),
        author: n.cast?.author?.username ?? "unknown",
        text: n.cast?.text ?? "",
        hash: n.cast?.hash ?? "",
        timestamp: n.cast?.timestamp ?? n.most_recent_timestamp ?? "",
      }))
      .filter((n) => n.hash);
  }

  return (
    <main className="wrap page single admin">
      <div>
        <AdminChrome chrome={chrome} />
        <h2>Farcaster{username ? ` · @${username}` : ""}</h2>
        <p className="status-line">
          fid {fid ?? "?"}
          {username ? (
            <>
              {" · "}
              <a href={`https://farcaster.xyz/${username}`}>view profile</a>
            </>
          ) : null}
        </p>
        <FarcasterClient username={username} casts={casts} notifications={notifications} />
      </div>
    </main>
  );
}
