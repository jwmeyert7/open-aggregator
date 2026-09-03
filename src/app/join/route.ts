import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/config";

/**
 * The short subscribe link used in tweets: <site>/join reads clean in
 * a post, and the tags ride on the redirect so X traffic still shows up in
 * analytics as the subscribe ask.
 */
export function GET() {
  return NextResponse.redirect(`${siteUrl()}/subscribe?utm_source=x&utm_medium=social&utm_campaign=subscribe-ask`, 302);
}
