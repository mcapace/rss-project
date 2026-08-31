import { NextRequest, NextResponse } from "next/server";
import Parser from "rss-parser";
import { getIssueFeedXml } from "@/lib/feed-builder";

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

  const host =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    "editions.marketwatchmag.com";
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const origin = `${proto}://${host}`;

  try {
    // 1. Check if it's an internal edition feed URL (/api/feeds/[brand]/[issue]/feed.xml)
    const internalMatch = url.match(
      /\/api\/feeds\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\/feed\.xml/
    );

    if (internalMatch) {
      const [, brand, issueId] = internalMatch;
      const xml = await getIssueFeedXml(brand, issueId, origin);

      if (!xml) {
        return NextResponse.json(
          {
            error: `Feed for ${brand.toUpperCase()} ${issueId} not found or not published.`,
          },
          { status: 404 }
        );
      }

      const parsedFeed = await parser.parseString(xml);
      return NextResponse.json(parsedFeed, {
        status: 200,
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      });
    }

    // 2. Otherwise fetch external XML and parse
    let targetUrl = url;
    if (targetUrl.startsWith("/")) {
      targetUrl = `${origin}${targetUrl}`;
    }

    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent": "MShanken-Digital-Editions-Reader/1.0",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
    });

    if (!res.ok) {
      throw new Error(
        `Failed to fetch feed: HTTP ${res.status} ${res.statusText}`
      );
    }

    const xmlText = await res.text();
    const parsedFeed = await parser.parseString(xmlText);

    return NextResponse.json(parsedFeed, {
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
