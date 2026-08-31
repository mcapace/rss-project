import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ issueUuid: string }> }
) {
  try {
    const { issueUuid } = await params;

    if (!issueUuid) {
      return NextResponse.json(
        { error: "issueUuid parameter is required" },
        { status: 400 }
      );
    }

    const sb = getServiceSupabase();

    // 1. Fetch issue details
    const { data: issue, error: issueError } = await sb
      .from("issues")
      .select("*")
      .eq("id", issueUuid)
      .single();

    if (issueError || !issue) {
      return NextResponse.json(
        { error: "Issue not found" },
        { status: 404 }
      );
    }

    // 2. Fetch counts for articles and images
    const { count: articleCount } = await sb
      .from("articles")
      .select("id", { count: "exact", head: true })
      .eq("issue_uuid", issueUuid);

    const { data: articles } = await sb
      .from("articles")
      .select("id")
      .eq("issue_uuid", issueUuid);

    let imageCount = 0;
    if (articles && articles.length > 0) {
      const articleIds = articles.map((a) => a.id);
      const { count: imgCount } = await sb
        .from("article_images")
        .select("id", { count: "exact", head: true })
        .in("article_uuid", articleIds);
      imageCount = imgCount || 0;
    }

    const feedUrl = `/api/feeds/${issue.brand}/${issue.issue_id}/feed.xml`;

    return NextResponse.json({
      issue,
      articleCount: articleCount || 0,
      imageCount,
      feedUrl,
    });
  } catch (error: any) {
    console.error("Failed to fetch issue details:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
