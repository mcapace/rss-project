import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { brand, issueId, issueLabel, tocPages, pdfKey } = body;

    if (!brand || !issueId || !issueLabel || !pdfKey) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: brand, issueId, issueLabel, pdfKey are required.",
        },
        { status: 400 }
      );
    }

    const normBrand = String(brand).toLowerCase().trim();
    const normIssueId = String(issueId).trim();
    const normIssueLabel = String(issueLabel).trim();

    // Parse toc_pages e.g. "3,4" or [3, 4]
    let parsedTocPages: number[] = [3, 4];
    if (Array.isArray(tocPages)) {
      parsedTocPages = tocPages.map((n) => Number(n)).filter((n) => !isNaN(n));
    } else if (typeof tocPages === "string" && tocPages.trim()) {
      parsedTocPages = tocPages
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => !isNaN(n));
    }

    const sb = getServiceSupabase();

    // Upsert or insert issue record in Supabase
    // If (brand, issue_id) already exists, update its status to 'queued' and reset error
    const { data, error } = await sb
      .from("issues")
      .upsert(
        {
          brand: normBrand,
          issue_id: normIssueId,
          issue_label: normIssueLabel,
          pdf_key: pdfKey,
          toc_pages: parsedTocPages,
          status: "queued",
          error: null,
        },
        { onConflict: "brand,issue_id" }
      )
      .select("id")
      .single();

    if (error || !data) {
      console.error("Supabase issue insert error:", error);
      return NextResponse.json(
        { error: error?.message || "Failed to create issue record in database" },
        { status: 500 }
      );
    }

    const issueUuid = data.id;

    // Trigger GitHub Action if GITHUB_TOKEN is configured
    const githubToken = process.env.GITHUB_TOKEN;
    const githubRepo = process.env.GITHUB_REPO || "mcapace/rss-project";

    if (githubToken) {
      try {
        const ghRes = await fetch(
          `https://api.github.com/repos/${githubRepo}/actions/workflows/process-issue.yml/dispatches`,
          {
            method: "POST",
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: `Bearer ${githubToken}`,
              "X-GitHub-Api-Version": "2022-11-28",
              "User-Agent": "editions-rss-platform",
            },
            body: JSON.stringify({
              ref: "main",
              inputs: {
                issue_uuid: issueUuid,
                brand: normBrand,
                issue_id: normIssueId,
                pdf_key: pdfKey,
                toc_pages: parsedTocPages.join(","),
              },
            }),
          }
        );

        if (ghRes.ok || ghRes.status === 204) {
          // Update status to processing
          await sb
            .from("issues")
            .update({ status: "processing" })
            .eq("id", issueUuid);
        } else {
          const ghErr = await ghRes.text();
          console.warn("GitHub action dispatch warning:", ghRes.status, ghErr);
        }
      } catch (ghErr) {
        console.warn("GitHub dispatch request failed:", ghErr);
      }
    }

    return NextResponse.json({
      issueUuid,
      status: "queued",
    });
  } catch (error: any) {
    console.error("Process handler failed:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to initiate processing" },
      { status: 500 }
    );
  }
}
