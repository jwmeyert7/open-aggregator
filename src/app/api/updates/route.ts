import { NextRequest, NextResponse } from "next/server";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";

/** How many river items have arrived since the item id the client rendered with. */
export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since");
  if (!since) return NextResponse.json({ newCount: 0 });
  const state = await loadState();
  const idx = state.items.findIndex((i) => i.id === since);
  const newCount = idx === -1 ? state.items.length : idx;
  return NextResponse.json({ newCount });
}
