import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const sb = getServiceSupabase();

    // 1. Fetch all issues newest first
    const { data: issues, error } = await sb
      .from("issues")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase issues list query error:", error);
      return NextResponse.json(
        { error: error.message || "Failed to fetch issues" },
        { status: 500 }
      );
    }

    if (!issues || issues.length === 0) {
      return NextResponse.json({ issues: [] });
    }

    // 2. Fetch article counts per issue
    const issueIds = issues.map((i) => i.id);
    const { data: articleRows, error: artError } = await sb
      .from("articles")
      .select("issue_uuid")
      .in("issue_uuid", issueIds);

    const countsByIssue: Record<string, number> = {};
    if (articleRows && !artError) {
      for (const row of articleRows) {
        if (row.issue_uuid) {
          countsByIssue[row.issue_uuid] =
            (countsByIssue[row.issue_uuid] || 0) + 1;
        }
      }
    }

    // 3. Format response with computed counts and feed URLs
    const formattedIssues = issues.map((issue) => ({
      ...issue,
      articleCount: countsByIssue[issue.id] || 0,
      feedUrl: `/api/feeds/${issue.brand}/${issue.issue_id}/feed.xml`,
    }));

    return NextResponse.json({ issues: formattedIssues });
  } catch (error: any) {
    console.error("Issues list endpoint failure:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to retrieve issues list" },
      { status: 500 }
    );
  }
}
