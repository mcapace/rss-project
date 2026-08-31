import { NextRequest, NextResponse } from "next/server";
import { getIssueFeedXml } from "@/lib/feed-builder";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ brand: string; issue: string }> }
) {
  try {
    const { brand, issue: issueId } = await params;

    if (!brand || !issueId) {
      return new NextResponse("Brand and Issue identifier are required", {
        status: 400,
      });
    }

    const host =
      request.headers.get("x-forwarded-host") ||
      request.headers.get("host") ||
      "editions.marketwatchmag.com";
    const proto = request.headers.get("x-forwarded-proto") || "https";
    const origin = `${proto}://${host}`;

    const xml = await getIssueFeedXml(brand, issueId, origin);

    if (!xml) {
      return new NextResponse("Published feed not found", {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      });
    }

    return new NextResponse(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control":
          "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (error: any) {
    console.error("Feed XML generation failure:", error);
    return new NextResponse("Internal Server Error generating feed XML", {
      status: 500,
    });
  }
}
