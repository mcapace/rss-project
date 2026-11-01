import { HeadObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * The standard bottle shot for a rating (public/bottles/<brand>/<slug>.webp,
 * written by scripts/bottle-images.ts). When one exists the request is sent on
 * to a signed S3 link for it (nothing streams through the function); a rating
 * without one answers 404 and the page hides the picture. Every S3 call has a
 * short deadline so a slow bucket can only ever cost a few seconds, never a
 * hung image.
 */
const BRANDS = new Set(["wa"]);
const S3_DEADLINE_MS = 4000;
let client: S3Client | null = null;

function s3() {
  client ??= new S3Client({
    region: process.env.AWS_REGION || "us-east-1",
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 2000, requestTimeout: S3_DEADLINE_MS },
  });
  return client;
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`S3 deadline of ${ms} ms passed`)), ms);
    work.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const brand = (new URL(request.url).searchParams.get("brand") ?? "wa").toLowerCase();
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(slug) || !BRANDS.has(brand)) return new NextResponse(null, { status: 404 });
  const bucket = process.env.S3_BUCKET;
  if (bucket) {
    const key = `public/bottles/${brand}/${slug}.webp`;
    const started = Date.now();
    try {
      await withDeadline(s3().send(new HeadObjectCommand({ Bucket: bucket, Key: key })), S3_DEADLINE_MS);
      const signed = await getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 60 * 60 * 24 * 6 });
      return NextResponse.redirect(signed, { status: 302, headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400", "X-Bottle-Shot": "standard" } });
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error";
      const message = error instanceof Error ? error.message : String(error);
      if (name !== "NotFound" && !/NotFound|NoSuchKey|404/.test(message)) console.warn(`[wa/bottle] ${slug}: ${name} ${message} after ${Date.now() - started} ms`);
    }
  }
  return new NextResponse(null, { status: 404, headers: { "Cache-Control": "public, max-age=300, s-maxage=3600" } });
}
