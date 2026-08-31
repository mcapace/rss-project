import { NextRequest, NextResponse } from "next/server";
import Parser from "rss-parser";

const parser = new Parser({
  customFields: {
    item: [
      ["media:content", "mediaContent"],
      ["content:encoded", "contentEncoded"],
      ["description", "description"],
    ],
  },
});

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  let url = searchParams.get("url");

  if (!url) {
    return NextResponse.json(
      { error: "Query parameter 'url' is required" },
      { status: 400 }
    );
  }

  // Handle relative URLs (e.g. /api/feeds/mw/2026-04/feed.xml)
  if (url.startsWith("/")) {
    const origin = request.nextUrl.origin;
    url = `${origin}${url}`;
  }

  try {
    const feed = await parser.parseURL(url);
    return NextResponse.json(feed, {
      status: 200,
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (error: any) {
    console.error("Failed to parse RSS feed:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to fetch or parse RSS feed" },
      { status: 500 }
    );
  }
}
