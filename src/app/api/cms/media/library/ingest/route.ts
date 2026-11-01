import { createHash, timingSafeEqual } from "node:crypto";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client } from "@/lib/s3";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * TEMPORARY (2026-11-01): receives the Morweb gallery files that only a machine outside GitHub's
 * network can download, and stores them in the shared content-addressed store. Off unless
 * WA_INGEST_SECRET is set; the secret and this route are removed once the gallery copy is done.
 * Accepts only cms/legacy/wa/<sha256>.<ext>, checks the body hashes to that sha, never overwrites.
 */
const KEY = /^cms\/legacy\/wa\/([a-f0-9]{64})\.(jpg|png|gif|webp|avif|tif|mp4|mov|pdf|bin)$/;
const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif", tif: "image/tiff", mp4: "video/mp4", mov: "video/quicktime", pdf: "application/pdf", bin: "application/octet-stream" };

function allowed(request: Request): boolean {
  const secret = process.env.WA_INGEST_SECRET ?? "";
  const given = request.headers.get("x-ingest-secret") ?? "";
  if (secret.length < 32 || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

export async function PUT(request: Request) {
  if (!allowed(request)) return new Response(null, { status: 404 });
  const key = new URL(request.url).searchParams.get("key") ?? "";
  const match = KEY.exec(key);
  if (!match) return Response.json({ error: "bad key" }, { status: 422 });
  const bucket = process.env.S3_BUCKET;
  if (!bucket) return Response.json({ error: "no bucket" }, { status: 503 });
  const body = Buffer.from(await request.arrayBuffer());
  if (!body.length) return Response.json({ error: "empty" }, { status: 422 });
  if (createHash("sha256").update(body).digest("hex") !== match[1]) return Response.json({ error: "hash mismatch" }, { status: 422 });
  const s3 = getS3Client();
  const exists = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })).then(() => true, () => false);
  if (!exists) await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: TYPES[match[2]], CacheControl: "public, max-age=31536000, immutable" }));
  return Response.json({ key, existed: exists, bytes: body.length });
}
