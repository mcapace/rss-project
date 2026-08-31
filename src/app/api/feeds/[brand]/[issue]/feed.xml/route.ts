import { NextRequest, NextResponse } from "next/server";
import { getAnonSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { generateRssFeed, FeedArticle } from "@/lib/feed-builder";

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

    const normBrand = brand.toLowerCase();
    const normIssue = issueId.trim();

    // Use service role client server-side or anon client
    let sb;
    try {
      sb = getServiceSupabase();
    } catch {
      sb = getAnonSupabase();
    }

    // 1. Query for published issue only
    const { data: issue, error: issueError } = await sb
      .from("issues")
      .select("*")
      .eq("brand", normBrand)
      .eq("issue_id", normIssue)
      .eq("status", "published")
      .single();

    if (issueError || !issue) {
      return new NextResponse("Published feed not found", {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // 2. Load included articles ordered by sort_order
    const { data: articles, error: artError } = await sb
      .from("articles")
      .select("*")
      .eq("issue_uuid", issue.id)
      .eq("include", true)
      .order("sort_order", { ascending: true });

    if (artError) {
      console.error("Error fetching articles for feed:", artError);
      return new NextResponse("Error loading feed articles", { status: 500 });
    }

    // 3. Load included images for all articles
    const articleIds = (articles || []).map((a) => a.id);
    let imagesByArticle: Record<string, any[]> = {};

    if (articleIds.length > 0) {
      const { data: images, error: imgError } = await sb
        .from("article_images")
        .select("*")
        .in("article_uuid", articleIds)
        .eq("include", true)
        .order("sort_order", { ascending: true });

      if (!imgError && images) {
        for (const img of images) {
          if (!imagesByArticle[img.article_uuid]) {
            imagesByArticle[img.article_uuid] = [];
          }
          imagesByArticle[img.article_uuid].push(img);
        }
      }
    }

    // 4. Attach images to articles
    const enrichedArticles: FeedArticle[] = (articles || []).map((art) => ({
      ...art,
      images: imagesByArticle[art.id] || [],
    }));

    // 5. Generate RSS 2.0 XML
    const origin = request.nextUrl.origin || "https://editions.marketwatchmag.com";
    const xml = generateRssFeed(
      {
        id: issue.id,
        brand: issue.brand,
        issue_id: issue.issue_id,
        issue_label: issue.issue_label,
        pdf_key: issue.pdf_key,
        created_at: issue.created_at,
        articles: enrichedArticles,
      },
      origin
    );

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
