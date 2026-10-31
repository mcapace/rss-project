#!/usr/bin/env node
/**
 * Standard bottle shots for the public site. Every rating's legacy photograph
 * is fetched, its flat background lifted to transparency (a flood fill from the
 * edges, so a bottle on white, grey or any flat colour comes out clean; a bottle
 * in a scene is left as photographed), trimmed, and set in the same 3:4 frame at
 * 480 by 640, stored as WebP under public/bottles/<slug>.webp in the media
 * bucket with a manifest beside it. Dry-run by default.
 *
 *   node --import tsx scripts/bottle-images.ts --brand wa --limit 100
 *   node --import tsx scripts/bottle-images.ts --brand wa --apply
 *
 * Apply needs AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET.
 */
import { parseArgs } from "node:util";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { brandFlag, connectReader } from "./lib/target";

const LEGACY_BASE: Record<string, string> = { wa: "https://whiskyadvocate.com", ws: "https://www.winespectator.com", ca: "https://www.cigaraficionado.com", mw: "https://www.marketwatch.com" };
const FRAME = { w: 480, h: 640, pad: 24 };

/** Lift a flat background: flood from the edges over pixels close to the corner colour; returns the share removed. */
export function liftBackground(data: Buffer, width: number, height: number, tolerance = 54): number {
  const px = (x: number, y: number) => (y * width + x) * 4;
  const corners = [px(0, 0), px(width - 1, 0), px(0, height - 1), px(width - 1, height - 1)];
  const bg = [0, 1, 2].map(c => Math.round(corners.reduce((a, i) => a + data[i + c], 0) / 4));
  const spread = corners.reduce((m, i) => Math.max(m, Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2])), 0);
  if (spread > tolerance) return 0; // the corners disagree: a scene, not a flat sweep
  const close = (i: number) => Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) <= tolerance;
  const seen = new Uint8Array(width * height); const stack: number[] = [];
  for (let x = 0; x < width; x++) { stack.push(x, (height - 1) * width + x); }
  for (let y = 0; y < height; y++) { stack.push(y * width, y * width + width - 1); }
  let removed = 0;
  while (stack.length) {
    const p = stack.pop() as number; if (seen[p]) continue; seen[p] = 1;
    if (!close(p * 4)) continue;
    data[p * 4 + 3] = 0; removed++;
    const x = p % width, y = (p - x) / width;
    if (x > 0) stack.push(p - 1); if (x < width - 1) stack.push(p + 1); if (y > 0) stack.push(p - width); if (y < height - 1) stack.push(p + width);
  }
  // Soften the cut edge: a pixel next to a removed one fades by how close it is to the background colour.
  for (let p = 0; p < width * height; p++) {
    if (data[p * 4 + 3] === 0) continue;
    const x = p % width, y = (p - x) / width;
    const edge = (x > 0 && data[(p - 1) * 4 + 3] === 0) || (x < width - 1 && data[(p + 1) * 4 + 3] === 0) || (y > 0 && data[(p - width) * 4 + 3] === 0) || (y < height - 1 && data[(p + width) * 4 + 3] === 0);
    if (!edge) continue;
    const d = Math.abs(data[p * 4] - bg[0]) + Math.abs(data[p * 4 + 1] - bg[1]) + Math.abs(data[p * 4 + 2] - bg[2]);
    data[p * 4 + 3] = Math.round(255 * Math.min(1, d / (tolerance * 2)));
  }
  return removed / (width * height);
}

/**
 * A framed product shot often keeps a white or grey rectangle inside the
 * transparent margin, because that rectangle was not the corner colour.
 * Walk out from every clear pixel and remove the light, neutral mat it touches.
 * A label stays when the bottle stands between it and the background.
 */
export function clearMat(data: Buffer, width: number, height: number): number {
  const n = width * height;
  const open = new Uint8Array(n);
  const stack: number[] = [];
  for (let p = 0; p < n; p++) {
    if (data[p * 4 + 3] < 16) { open[p] = 1; stack.push(p); }
  }
  if (!stack.length) return 0;
  const mat = (i: number) => {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 16) return false;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    return min >= 198 && max - min <= 22;
  };
  let removed = 0;
  while (stack.length) {
    const p = stack.pop() as number;
    const x = p % width, y = (p - x) / width;
    const next = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1];
    for (const q of next) {
      if (q < 0 || open[q]) continue;
      if (!mat(q * 4)) continue;
      open[q] = 1;
      data[q * 4 + 3] = 0;
      removed++;
      stack.push(q);
    }
  }
  return removed / n;
}

/** Share of the frame that is an opaque near-white or light-grey pixel. */
export function matShare(data: Buffer, width: number, height: number): number {
  const n = width * height;
  let mat = 0;
  for (let p = 0; p < n; p++) {
    const i = p * 4, r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 16) continue;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (min >= 198 && max - min <= 22) mat++;
  }
  return mat / n;
}

export async function standardShot(bytes: Buffer): Promise<{ webp: Buffer; lifted: number; before: number; after: number }> {
  const base = sharp(bytes, { failOn: "none" }).rotate().ensureAlpha();
  const { data, info } = await base.raw().toBuffer({ resolveWithObject: true });
  const before = matShare(data, info.width, info.height);
  const corner = (x: number, y: number) => data[(y * info.width + x) * 4 + 3] > 16;
  const cornersOpaque = [corner(0, 0), corner(info.width - 1, 0), corner(0, info.height - 1), corner(info.width - 1, info.height - 1)].filter(Boolean).length >= 3;
  const lifted = cornersOpaque ? liftBackground(data, info.width, info.height) : 0;
  clearMat(data, info.width, info.height);
  const after = matShare(data, info.width, info.height);
  const cut = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).trim({ threshold: 8 });
  const fitted = await cut.resize({ width: FRAME.w - FRAME.pad * 2, height: FRAME.h - FRAME.pad * 2, fit: "inside", withoutEnlargement: false }).png().toBuffer();
  const webp = await sharp({ create: { width: FRAME.w, height: FRAME.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: fitted, gravity: "centre" }]).webp({ quality: 84, alphaQuality: 90 }).toBuffer();
  return { webp, lifted, before, after };
}

/** The legacy site drops connections under load: three tries, a pause between them, a browser's user agent. */
async function fetchWithRetries(url: string, tries = 3): Promise<Buffer> {
  let last: unknown = null;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; WhiskyAdvocateBottleShots/1.0)", Accept: "image/*,*/*;q=0.8" }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) { last = error; if (attempt < tries) await new Promise(resolve => setTimeout(resolve, 1500 * attempt)); }
  }
  throw last instanceof Error ? last : new Error("fetch failed");
}

export async function runBottleImages(args: string[], log: (line: string) => void = console.log) {
  const { values } = parseArgs({ args, options: { brand: { type: "string", default: "wa" }, limit: { type: "string", default: "3000" }, apply: { type: "boolean", default: false }, help: { type: "boolean", default: false }, "development-target": { type: "string" } }, strict: true });
  if (values.help) { log("Usage: bottle-images --brand wa [--limit N] [--apply]"); return; }
  const brand = brandFlag(values.brand);
  const limit = Math.min(10000, Math.max(1, Number(values.limit) || 3000));
  const reader = connectReader();
  const bucket = process.env.S3_BUCKET;
  if (values.apply && !bucket) throw new Error("Apply needs S3_BUCKET and AWS credentials.");
  const s3 = values.apply ? new S3Client({ region: process.env.AWS_REGION || "us-east-1" }) : null;
  // Every published rating, a page of 1000 at a time (the API caps a single read at 1000 rows).
  const data: { document_id: string; cms_documents: unknown }[] = [];
  for (let from = 0; from < limit * 4; from += 1000) {
    const page = await reader.from("cms_ratings").select("document_id,cms_documents!inner(slug,metadata,publication_state)").eq("brand", brand).eq("cms_documents.publication_state", "published").order("document_id").range(from, from + 999);
    if (page.error) throw new Error(`Could not read ratings: ${page.error.message}`);
    data.push(...((page.data ?? []) as { document_id: string; cms_documents: unknown }[]));
    if ((page.data ?? []).length < 1000) break;
  }
  const manifestKey = `public/bottles/${brand}/manifest.json`;
  let manifest: Record<string, { key: string; lifted: number; source: string }> = {};
  if (s3 && bucket) { try { const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: manifestKey })); manifest = JSON.parse(await got.Body!.transformToString()) as typeof manifest; } catch { manifest = {}; } }
  const summary = { mode: values.apply ? "apply" : "dry-run", brand, documents: 0, processed: 0, lifted: 0, skipped: 0, failures: [] as string[] };
  for (const row of data as { document_id: string; cms_documents: { slug: string | null; metadata: Record<string, unknown> } | { slug: string | null; metadata: Record<string, unknown> }[] }[]) {
    if (summary.documents >= limit) break;
    const doc = Array.isArray(row.cms_documents) ? row.cms_documents[0] : row.cms_documents;
    const legacy = (doc?.metadata?.legacy_media ?? {}) as { thumb_file?: string };
    const raw = typeof legacy.thumb_file === "string" ? legacy.thumb_file : "";
    if (!raw || !doc?.slug) continue;
    if (manifest[doc.slug] && manifest[doc.slug].source === raw) { summary.skipped += 1; continue; }
    summary.documents += 1;
    if (!s3 || !bucket) continue;
    try {
      const url = raw.startsWith("http") ? raw : new URL(raw, LEGACY_BASE[brand]).toString();
      const bytes = await fetchWithRetries(url);
      const { webp, lifted } = await standardShot(bytes);
      const key = `public/bottles/${brand}/${doc.slug}.webp`;
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: webp, ContentType: "image/webp", CacheControl: "public, max-age=31536000, immutable" }));
      manifest[doc.slug] = { key, lifted: Math.round(lifted * 100) / 100, source: raw };
      summary.processed += 1; if (lifted > 0.05) summary.lifted += 1;
      if (summary.processed % 100 === 0) await s3.send(new PutObjectCommand({ Bucket: bucket, Key: manifestKey, Body: JSON.stringify(manifest), ContentType: "application/json", CacheControl: "no-cache" }));
    } catch (failure) { summary.failures.push(`${doc.slug}: ${failure instanceof Error ? failure.message : "failed"}`); }
  }
  if (s3 && bucket) await s3.send(new PutObjectCommand({ Bucket: bucket, Key: manifestKey, Body: JSON.stringify(manifest), ContentType: "application/json", CacheControl: "no-cache" }));
  log(JSON.stringify({ ...summary, failures: summary.failures.slice(0, 40), failure_count: summary.failures.length }, null, 2));
}

if (/(?:^|[/\\])bottle-images\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  runBottleImages(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
}
