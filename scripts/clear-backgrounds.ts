#!/usr/bin/env node
/**
 * Clear the studio background behind bottle photographs.
 *
 * Ratings already live as framed WebP files. This walks every one and removes
 * a white or grey mat that the first pass left inside the frame.
 *
 * Posts, story heroes and Top 20 use the original files. Product shots
 * (the _300 thumbnails, files named bottle-shot, and Top 20 bottle renders)
 * are cleared and the pages are pointed at /api/wa/cleared/<id>. A bar, a
 * cocktail or a landscape is left as photographed.
 *
 * Dry-run unless --apply. Apply needs AWS_REGION, AWS_ACCESS_KEY_ID,
 * AWS_SECRET_ACCESS_KEY and S3_BUCKET.
 *
 *   node --env-file=.env.local --import tsx scripts/clear-backgrounds.ts
 *   node --env-file=.env.local --import tsx scripts/clear-backgrounds.ts --apply
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { clearMat, matShare, standardShot } from "./bottle-images";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "wa");
const PUBLIC = "https://rss-project-ten.vercel.app/api/wa/cleared/";
const RATING_PREFIX = "public/bottles/wa/";
const CLEARED_PREFIX = "public/bottles/wa/cleared/";

function isProductShot(url: string) {
  const path = url.toLowerCase().split("?")[0];
  if (path.includes("/images/bottles/")) return true;
  if (path.includes("bottle-shot") || path.includes("bottleshot")) return true;
  return /_300\.(png|jpe?g|webp)$/.test(path);
}

function idFor(url: string) {
  return createHash("sha256").update(url).digest("hex").slice(0, 20);
}

async function pool<T>(items: T[], limit: number, run: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await run(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

async function repairRatings(s3: S3Client, bucket: string, apply: boolean, log: (line: string) => void) {
  const listed: string[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: RATING_PREFIX, ContinuationToken: token }));
    for (const item of page.Contents ?? []) {
      const key = item.Key ?? "";
      if (key.endsWith(".webp") && !key.includes("/cleared/")) listed.push(key);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  const summary = { checked: 0, cleared: 0, kept: 0, failures: [] as string[] };
  await pool(listed, 8, async key => {
    summary.checked += 1;
    try {
      const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const buf = Buffer.from(await got.Body!.transformToByteArray());
      const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const before = matShare(data, info.width, info.height);
      if (before < 0.04) { summary.kept += 1; return; }
      clearMat(data, info.width, info.height);
      const after = matShare(data, info.width, info.height);
      if (before - after < 0.03) { summary.kept += 1; return; }
      summary.cleared += 1;
      if (!apply) return;
      const webp = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).webp({ quality: 84, alphaQuality: 90 }).toBuffer();
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: webp, ContentType: "image/webp", CacheControl: "public, max-age=86400" }));
    } catch (error) {
      summary.failures.push(`${key}: ${error instanceof Error ? error.message : "failed"}`);
    }
    if (summary.checked % 200 === 0) log(`ratings ${summary.checked}/${listed.length} cleared ${summary.cleared}`);
  });
  log(JSON.stringify({ ratings: listed.length, ...summary, failures: summary.failures.slice(0, 20), failure_count: summary.failures.length }));
}

function collectProductUrls() {
  const files = [
    join(ROOT, "stories.json"),
    join(ROOT, "top20.json"),
    ...readdirSync(join(ROOT, "articles")).map(name => join(ROOT, "articles", name)),
    ...readdirSync(join(ROOT, "notes")).map(name => join(ROOT, "notes", name)),
  ];
  const urls = new Set<string>();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/(?:https?:\/\/[^"\\\s>]+|\/[^"\\\s>]+)\.(?:jpg|jpeg|png|webp)/gi)) {
      const url = match[0];
      if (isProductShot(url) && !url.includes("/api/wa/")) urls.add(url);
    }
  }
  return { files, urls: [...urls] };
}

async function clearPosts(s3: S3Client | null, bucket: string | undefined, apply: boolean, log: (line: string) => void) {
  const { files, urls } = collectProductUrls();
  const replacements = new Map<string, string>();
  const summary = { candidates: urls.length, cleared: 0, kept: 0, failures: [] as string[] };
  await pool(urls, 6, async url => {
    try {
      const absolute = /^https?:\/\//i.test(url) ? url : "https://whiskyadvocate.com" + (url.startsWith("/") ? url : "/" + url);
      const response = await fetch(absolute, { headers: { "User-Agent": "Mozilla/5.0 (compatible; WhiskyAdvocateBottleShots/1.0)", Accept: "image/*,*/*;q=0.8" }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const shot = await standardShot(bytes);
      if (shot.lifted < 0.08 && shot.before - shot.after < 0.04) { summary.kept += 1; return; }
      const id = idFor(url);
      summary.cleared += 1;
      replacements.set(url, PUBLIC + id);
      if (!apply || !s3 || !bucket) return;
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: CLEARED_PREFIX + id + ".webp", Body: shot.webp, ContentType: "image/webp", CacheControl: "public, max-age=31536000, immutable" }));
    } catch (error) {
      summary.failures.push(`${url.slice(-80)}: ${error instanceof Error ? error.message : "failed"}`);
    }
    if ((summary.cleared + summary.kept + summary.failures.length) % 100 === 0) log(`posts ${summary.cleared + summary.kept + summary.failures.length}/${urls.length} cleared ${summary.cleared}`);
  });
  let rewritten = 0;
  if (apply && replacements.size) {
    for (const file of files) {
      let text = readFileSync(file, "utf8");
      let changed = false;
      for (const [from, to] of replacements) {
        if (!text.includes(from)) continue;
        text = text.split(from).join(to);
        changed = true;
      }
      if (changed) { writeFileSync(file, text); rewritten += 1; }
    }
  }
  log(JSON.stringify({ posts: summary.candidates, cleared: summary.cleared, kept: summary.kept, files_rewritten: rewritten, failures: summary.failures.slice(0, 20), failure_count: summary.failures.length }));
}

async function main() {
  const { values } = parseArgs({ args: process.argv.slice(2), options: { apply: { type: "boolean", default: false } }, strict: true });
  const log = (line: string) => console.log(line);
  const bucket = process.env.S3_BUCKET;
  if (values.apply && !bucket) throw new Error("Apply needs S3_BUCKET and AWS credentials.");
  const s3 = bucket ? new S3Client({ region: process.env.AWS_REGION || "us-east-1" }) : null;
  log(values.apply ? "apply" : "dry-run");
  if (s3 && bucket) await repairRatings(s3, bucket, values.apply, log);
  else log("No S3 credentials, so stored rating shots were not checked.");
  await clearPosts(s3, bucket, values.apply, log);
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
