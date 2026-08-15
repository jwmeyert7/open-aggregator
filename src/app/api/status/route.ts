import { NextResponse } from "next/server";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

/** Tiny health endpoint for uptime monitors: is the site up, and how fresh is state. */
export async function GET() {
  try {
    const state = await loadState();
    return NextResponse.json({ ok: true, updatedAt: state.updatedAt, items: state.items.length });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
