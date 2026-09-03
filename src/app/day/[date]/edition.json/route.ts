import { loadDailyDigest, loadDailyDigestVersion } from "@/lib/state";
import { editionCore } from "@/lib/util";

export const dynamic = "force-dynamic";

/**
 * The frozen edition's sealed bytes, downloadable. This response body is
 * EXACTLY what was hashed at freeze time (compact JSON of the edition core,
 * post-freeze bookkeeping stripped), so sha256 of the downloaded file equals
 * the contentHash on the day page and in the onchain attestation. That
 * byte-for-byte promise is the whole point: never pretty-print or reorder.
 */
export async function GET(req: Request, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response("Not found", { status: 404 });
  // ?v=N serves a superseded version's file, byte for byte as it was sealed;
  // without it, the current version
  const wanted = Number(new URL(req.url).searchParams.get("v") ?? "");
  const current = await loadDailyDigest(date);
  if (!current || current.inProgress || !current.contentHash) return new Response("Not found", { status: 404 });
  const currentVersion = current.version ?? 1;
  const digest = Number.isInteger(wanted) && wanted >= 1 && wanted < currentVersion ? await loadDailyDigestVersion(date, wanted) : current;
  if (!digest) return new Response("Not found", { status: 404 });
  const version = digest.version ?? 1;
  return new Response(JSON.stringify(editionCore(digest)), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="edition-${date}${version > 1 ? `-v${version}` : ""}.json"`,
      "cache-control": "public, s-maxage=3600",
    },
  });
}
