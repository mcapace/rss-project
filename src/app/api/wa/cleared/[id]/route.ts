import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * A bottle photograph from a story or the Top 20 whose studio background has
 * been lifted (public/bottles/wa/cleared/<id>.webp, written by
 * scripts/clear-backgrounds.ts). The request is sent on to a signed S3 link.
 */
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

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[a-f0-9]{20}$/.test(id)) return new NextResponse(null, { status: 404 });
  const bucket = process.env.S3_BUCKET;
  if (!bucket) return new NextResponse(null, { status: 404 });
  const key = `public/bottles/wa/cleared/${id}.webp`;
  try {
    await withDeadline(s3().send(new HeadObjectCommand({ Bucket: bucket, Key: key })), S3_DEADLINE_MS);
    const signed = await getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 60 * 60 * 24 * 6 });
    return NextResponse.redirect(signed, { status: 302, headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400", "X-Bottle-Shot": "cleared" } });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
