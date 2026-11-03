import { NextResponse } from "next/server";
import { deliveryEnabled } from "@/lib/cms/runtime-config";
import { liveStories } from "@/lib/wa/live-stories";

export const runtime = "nodejs";
export const maxDuration = 15;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };

export function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

/**
 * The stories published from the CMS that the static story index (stories.json) has not caught up with, in the same
 * shape, and the paid ones among them; plus the slugs the static files still list that are no longer live: `removed`
 * for stories (stories.json and stories-archive.json), `removedRatings` for ratings (ratings.json). Those two only
 * ever name slugs already in the public files, never a draft or review item that was not published. site.js merges
 * this over the static files; ads.js reads the sponsored list. Cached a minute at the edge, so a publish or a takedown
 * shows within about a minute.
 */
export async function GET() {
  if (!deliveryEnabled()) return NextResponse.json({ stories: [], removed: [], removedRatings: [], sponsored: [] }, { headers: { ...CORS, "Cache-Control": "public, s-maxage=60" } });
  try {
    return NextResponse.json(await liveStories(), { headers: { ...CORS, "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
  } catch (error) {
    console.error("[wa/latest]", error instanceof Error ? error.message : error);
    return NextResponse.json({ stories: [], removed: [], removedRatings: [], sponsored: [] }, { status: 502, headers: { ...CORS, "Cache-Control": "no-store" } });
  }
}
