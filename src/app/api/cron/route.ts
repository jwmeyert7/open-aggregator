import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runPipeline } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The 15-minute pipeline entrypoint. Vercel Cron calls GET with
 * `Authorization: Bearer $CRON_SECRET` automatically. Fails closed: with no
 * CRON_SECRET set, nothing can trigger the pipeline (which spends LLM money
 * and posts to social), so a fork without the env var is safe, not open.
 */
async function handle(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  const header = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || header.length !== expected.length || !crypto.timingSafeEqual(header, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const report = await runPipeline();
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
