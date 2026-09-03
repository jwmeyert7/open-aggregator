import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/config";

/** Short month link for tweets: /m/2026-08 opens the month page with the X campaign tags attached here. */
export async function GET(_req: Request, { params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  if (!/^\d{4}-\d{2}$/.test(month)) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(`${siteUrl()}/month/${month}?utm_source=x&utm_medium=social&utm_campaign=monthly-${month}`, 302);
}
