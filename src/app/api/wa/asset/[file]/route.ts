import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { getS3Client } from "@/lib/s3";
import { renderRendition, type RenditionFormat } from "@/lib/media/renditions";

export const runtime = "nodejs";
export const maxDuration = 15;

const FORMATS = new Set<RenditionFormat>(["webp", "avif", "jpeg", "png"]);

/**
 * A legacy Whisky Advocate image re-hosted for the static site's own data (cocktails, Top 20, video,
 * 90+ Club), served from its content-addressed copy (cms/legacy/wa/<sha256>.<ext>, written by
 * scripts/wa-rehost-static.ts). `?w=` resizes and `?format=` converts, like /api/media. A PDF a story
 * links to (scripts/wa-rewrite-legacy-links.ts) is served as stored. A video (a Morweb gallery clip a story
 * plays) redirects to a short-lived signed S3 address, so the browser streams and seeks from S3 directly.
 */
export async function GET(request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  if (!/^[a-f0-9]{64}\.(jpg|png|gif|webp|avif|pdf|mp4|mov|m4v|webm)$/.test(file)) return new NextResponse(null, { status: 404 });
  const bucket = process.env.S3_BUCKET;
  if (!bucket) return new NextResponse(null, { status: 503 });
  const video = /\.(mp4|mov|m4v|webm)$/.exec(file);
  if (video) {
    // QuickTime clips from the old galleries are H.264; served as MP4 every browser plays them.
    const type = video[1] === "webm" ? "video/webm" : "video/mp4";
    const signed = await getSignedUrl(getS3Client(), new GetObjectCommand({ Bucket: bucket, Key: `cms/legacy/wa/${file}`, ResponseContentType: type, ResponseCacheControl: "public, max-age=86400" }), { expiresIn: 6 * 3600 });
    return new Response(null, { status: 302, headers: { Location: signed, "Cache-Control": "public, max-age=3600, s-maxage=3600" } });
  }
  if (file.endsWith(".pdf")) {
    try {
      const object = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: `cms/legacy/wa/${file}` }));
      const bytes = await object.Body?.transformToByteArray();
      if (!bytes) return new NextResponse(null, { status: 404 });
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Cache-Control": "public, max-age=86400, s-maxage=31536000, immutable" } });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      return new NextResponse(null, { status: name === "NoSuchKey" || name === "NotFound" ? 404 : 502 });
    }
  }
  const url = new URL(request.url);
  const format = (url.searchParams.get("format") ?? "webp") as RenditionFormat;
  const width = url.searchParams.get("w") ? Number(url.searchParams.get("w")) : null;
  if (!FORMATS.has(format) || (width !== null && (!Number.isFinite(width) || width < 16 || width > 2400))) return new NextResponse(null, { status: 422 });
  try {
    const object = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: `cms/legacy/wa/${file}` }));
    const bytes = await object.Body?.transformToByteArray();
    if (!bytes) return new NextResponse(null, { status: 404 });
    const rendition = await renderRendition(bytes, { width, format });
    return new Response(new Uint8Array(rendition.body), { headers: { "Content-Type": rendition.contentType, "Cache-Control": "public, max-age=86400, s-maxage=31536000, immutable" } });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return new NextResponse(null, { status: name === "NoSuchKey" || name === "NotFound" ? 404 : 502 });
  }
}
