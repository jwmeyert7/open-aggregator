import { after, type NextRequest } from "next/server";
import { recordClick } from "@/lib/metrics";

export const dynamic = "force-dynamic";

/**
 * Outbound click counter. ClickBeacons fires a sendBeacon here when a reader
 * follows a story or sponsored link off-site; nothing about the response
 * matters to the page, so it's an immediate 204 with the counting deferred.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text().catch(() => "");
  const isAdmin = req.cookies.get("oa_admin_ui")?.value === "1";
  after(() => recordClick(raw, isAdmin));
  return new Response(null, { status: 204 });
}
