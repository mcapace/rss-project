import { NextRequest, NextResponse } from "next/server";
import { createPresignedUploadUrl } from "@/lib/s3";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { brand, issueId, filename } = body;

    if (!brand || !issueId) {
      return NextResponse.json(
        { error: "brand and issueId are required fields." },
        { status: 400 }
      );
    }

    const normBrand = String(brand).toLowerCase().trim();
    const normIssueId = String(issueId).trim();

    // S3 inbox key pattern per spec: pdfs/inbox/{brand}-{issueId}.pdf
    const pdfKey = `pdfs/inbox/${normBrand}-${normIssueId}.pdf`;

    const uploadUrl = await createPresignedUploadUrl({
      key: pdfKey,
      contentType: "application/pdf",
      expiresInSeconds: 1800, // 30 minutes
    });

    return NextResponse.json({
      uploadUrl,
      pdfKey,
    });
  } catch (error: any) {
    console.error("Error generating presigned upload URL:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to generate presigned upload URL" },
      { status: 500 }
    );
  }
}
