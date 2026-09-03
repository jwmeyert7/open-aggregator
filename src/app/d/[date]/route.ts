import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/config";

/** Short day link for tweets: /d/2026-09-02 opens the day page with the X campaign tags attached here. */
export async function GET(_req: Request, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(`${siteUrl()}/day/${date}?utm_source=x&utm_medium=social&utm_campaign=daily-${date}`, 302);
}
