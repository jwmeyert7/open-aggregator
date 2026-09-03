import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/config";

/** Short week link for tweets: /w/2026-09-04 opens the week page with the X campaign tags attached here. */
export async function GET(_req: Request, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(`${siteUrl()}/week/${date}?utm_source=x&utm_medium=social&utm_campaign=weekly-${date}`, 302);
}
