#!/usr/bin/env node
/**
 * Re-hosts the legacy images the static Whisky Advocate site's own data files point at (Morweb's
 * whiskyadvocate.com/files and /get/files, and the old WordPress bucket) into S3, content-addressed
 * at cms/legacy/wa/<sha256>.<ext>, and rewrites each reference to /api/wa/asset/<sha256>.<ext>.
 * Dry-run by default.
 *
 *   node --import tsx scripts/wa-rehost-static.ts [--files cocktails.json,top20.json] [--apply]
 *
 * Apply needs AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { decodeEntities, sniffImageType } from "./rehost-media";

const DIR = "public/wa";
const DEFAULT_FILES = ["cocktails.json", "top20.json", "videos.json", "ninety.json", "stories.json", "stories-archive.json"];
const LEGACY = /(?:https?:)?\/\/(?:www\.)?(?:whiskyadvocate\.com|mscwordpresscontent\.s3\.amazonaws\.com)\/[^"\\\s<>]+?\.(?:jpe?g|png|gif|webp|avif)(?:\?[^"\\\s<>]*)?(?=["\\\s<>]|$)/gi;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };

export function legacyStaticUrls(text: string): string[] {
  return [...new Set([...text.matchAll(LEGACY)].map(match => match[0]))];
}

async function main() {
  const { values } = parseArgs({ options: { files: { type: "string", default: DEFAULT_FILES.join(",") }, apply: { type: "boolean", default: false } } });
  const files = values.files.split(",").map(file => file.trim()).filter(Boolean);
  const bucket = process.env.S3_BUCKET;
  if (values.apply && !bucket) throw new Error("Apply needs S3_BUCKET and AWS credentials.");
  const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
  const texts = new Map(files.map(file => [file, readFileSync(`${DIR}/${file}`, "utf8")]));
  const urls = [...new Set([...texts.values()].flatMap(legacyStaticUrls))];
  const replaced = new Map<string, string>();
  const failures: string[] = [];
  let next = 0;
  const work = async () => {
    while (next < urls.length) {
      const raw = urls[next++];
      const url = (raw.startsWith("//") ? `https:${raw}` : raw).replace(/\?resize=[^&]*$/, "");
      try {
        const response = await fetch(new URL(decodeEntities(url)), { headers: { "User-Agent": "mshanken-cms-migration/1.0" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        const declared = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        const type = EXT[declared] ? declared : sniffImageType(bytes) ?? declared;
        if (!EXT[type]) throw new Error(`unsupported type ${type || "unknown"}`);
        const file = `${createHash("sha256").update(bytes).digest("hex")}.${EXT[type]}`;
        if (values.apply) {
          const key = `cms/legacy/wa/${file}`;
          const exists = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })).then(() => true, () => false);
          if (!exists) await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: type, CacheControl: "public, max-age=31536000, immutable" }));
        }
        replaced.set(raw, `/api/wa/asset/${file}`);
      } catch (error) { failures.push(`${raw}: ${error instanceof Error ? error.message : "failed"}`); }
    }
  };
  await Promise.all(Array.from({ length: 12 }, work));
  let rewritten = 0;
  for (const [file, text] of texts) {
    let out = text;
    for (const [raw, target] of replaced) if (out.includes(raw)) { out = out.split(raw).join(target); rewritten += 1; }
    if (values.apply && out !== text) writeFileSync(`${DIR}/${file}`, out);
  }
  console.log(JSON.stringify({ mode: values.apply ? "apply" : "dry-run", files, urls: urls.length, rehosted: replaced.size, rewritten, failures }, null, 2));
}

if (/(?:^|[/\\])wa-rehost-static\.(?:ts|js)$/.test(process.argv[1] ?? "")) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
