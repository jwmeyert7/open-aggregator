import { NextResponse } from "next/server";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

/** Playback data for one shelf episode, for mention links that play in place. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[a-f0-9]{6,16}$/.test(id)) return NextResponse.json({ ok: false }, { status: 400 });
  const state = await loadState();
  const m = (state.mediaItems ?? []).find((x) => x.id === id && !x.hidden);
  if (!m) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json(
    {
      url: m.url,
      kind: m.kind,
      title: m.displayTitle ?? m.title,
      ...(m.audioUrl ? { audioUrl: m.audioUrl } : {}),
      ...(m.videoUrl ? { videoUrl: m.videoUrl } : {}),
    },
    { headers: { "cache-control": "public, max-age=60" } }
  );
}
