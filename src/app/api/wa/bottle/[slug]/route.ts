import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { cmsDb } from "@/lib/cms/db";

export const runtime = "nodejs";

/**
 * The standard bottle shot for a rating (public/bottles/<brand>/<slug>.webp,
 * written by scripts/bottle-images.ts). Until a rating has one, the request is
 * sent on to the legacy photograph so the page never shows a hole.
 */
const BASE: Record<string, string> = { wa: "https://whiskyadvocate.com" };
let client: S3Client | null = null;

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const brand = (new URL(request.url).searchParams.get("brand") ?? "wa").toLowerCase();
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(slug) || !BASE[brand]) return new NextResponse(null, { status: 404 });
  const bucket = process.env.S3_BUCKET;
  if (bucket) {
    try {
      client ??= new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
      const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `public/bottles/${brand}/${slug}.webp` }));
      const bytes = await got.Body!.transformToByteArray();
      return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000", "X-Bottle-Shot": "standard" } });
    } catch { /* not standardized yet: fall through to the legacy photograph */ }
  }
  try {
    const { data } = await cmsDb().from("cms_documents").select("metadata").eq("brand", brand).eq("slug", slug).eq("kind", "rating").limit(1).maybeSingle();
    const legacy = (data?.metadata as { legacy_media?: { thumb_file?: string } } | null)?.legacy_media?.thumb_file;
    if (legacy) return NextResponse.redirect(legacy.startsWith("http") ? legacy : new URL(legacy, BASE[brand]).toString(), { status: 302, headers: { "Cache-Control": "public, max-age=3600" } });
  } catch { /* no database: nothing to send on to */ }
  return new NextResponse(null, { status: 404 });
}
