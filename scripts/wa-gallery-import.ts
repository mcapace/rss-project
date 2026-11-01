#!/usr/bin/env node
/**
 * Copies every file in the Morweb gallery library into S3, so the whole library
 * survives the old site. The catalog (cms_media_galleries, cms_media_files) is filled
 * from the migration archive by the 20261101210000_cms_media_galleries migration;
 * files a story had already copied are marked stored there. This script takes the
 * pending ones: it downloads each from whiskyadvocate.com, stores it once in the
 * shared content-addressed store (cms/legacy/<brand>/<sha256>.<ext>, the store story
 * images and /api/wa/asset use; an existing copy is not written again) and records
 * the hash, key and size. A file that cannot be fetched is marked failed with the
 * reason; --retry-failed tries those again.
 *
 *   node --import tsx scripts/wa-gallery-import.ts --brand wa [--limit 300]
 *   node --import tsx scripts/wa-gallery-import.ts --brand wa --limit 300 --apply --development-target <host>
 */
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { brandFlag, connectReader, connectTarget } from "./lib/target";

type Row = { source_gallery_id: string; source_file_id: string; file_name: string; mime: string; source_url: string };

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/tiff": "tif", "image/avif": "avif", "image/svg+xml": "svg", "video/mp4": "mp4", "video/quicktime": "mov", "application/pdf": "pdf" };

/** The extension the stored copy carries: from the file's own type, else its name. */
export function extensionFor(mime: string, fileName: string): string {
  const fromMime = EXT[(mime || "").toLowerCase().split(";")[0].trim()];
  if (fromMime) return fromMime;
  const fromName = (/\.([a-z0-9]{2,5})$/i.exec(fileName)?.[1] || "bin").toLowerCase();
  return fromName === "jpeg" ? "jpg" : fromName;
}

/** The Morweb address with each path segment encoded once (names carry spaces, commas and accents). */
export function fetchUrl(sourceUrl: string): string {
  const url = new URL(sourceUrl);
  url.pathname = url.pathname.split("/").map(part => encodeURIComponent(decodeURIComponentSafe(part))).join("/");
  return url.toString();
}
function decodeURIComponentSafe(value: string) { try { return decodeURIComponent(value); } catch { return value; } }

async function download(url: string): Promise<{ bytes: Buffer; type: string }> {
  const response = await fetch(fetchUrl(url), { redirect: "follow", signal: AbortSignal.timeout(120_000), headers: { "User-Agent": "WhiskyAdvocate-CMS-migration/1.0" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const type = (response.headers.get("content-type") || "").split(";")[0].trim();
  if (/^text\/html/i.test(type)) throw new Error("text/html instead of a file");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error("empty response");
  return { bytes, type };
}

export async function runGalleryImport(args: string[], log: (line: string) => void = console.log) {
  const { values } = parseArgs({ args, options: {
    brand: { type: "string", default: "wa" }, limit: { type: "string", default: "300" }, concurrency: { type: "string", default: "4" },
    "retry-failed": { type: "boolean", default: false }, apply: { type: "boolean", default: false }, "development-target": { type: "string" }, help: { type: "boolean", default: false },
  }, strict: true });
  if (values.help) { log("Usage: wa-gallery-import --brand wa [--limit N] [--concurrency N] [--retry-failed] [--apply --development-target HOST]"); return; }
  const brand = brandFlag(values.brand);
  const limit = Math.min(1000, Math.max(1, Number(values.limit) || 300));
  const concurrency = Math.min(8, Math.max(1, Number(values.concurrency) || 4));
  const reader = connectReader();
  const writer = connectTarget(values);
  const states = values["retry-failed"] ? ["pending", "failed"] : ["pending"];
  const { data, error } = await reader.from("cms_media_files").select("source_gallery_id,source_file_id,file_name,mime,source_url")
    .eq("brand", brand).in("status", states).order("source_gallery_id").order("source_file_id").limit(limit);
  if (error) throw new Error(`Could not read the gallery catalog: ${error.message}`);
  const rows = (data ?? []) as Row[];
  const summary = { mode: writer ? "development-apply" : "dry-run", brand, documents: rows.length, stored: 0, already_in_s3: 0, failed: 0, bytes: 0, failures: [] as string[] };
  if (!rows.length) { log(JSON.stringify(summary, null, 2)); return summary; }

  if (!writer) {
    // A dry run checks that the first few files can be fetched and writes nothing.
    for (const row of rows.slice(0, 5)) {
      try { const { bytes, type } = await download(row.source_url); summary.bytes += bytes.length; log(`ok ${row.file_name} ${type} ${bytes.length}B`); }
      catch (e) { summary.failures.push(`${row.file_name}: ${e instanceof Error ? e.message : e}`); }
    }
    log(JSON.stringify(summary, null, 2));
    return summary;
  }

  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("Set S3_BUCKET to copy gallery files.");
  const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });

  async function copy(row: Row) {
    const match = { brand, source_gallery_id: row.source_gallery_id, source_file_id: row.source_file_id };
    try {
      const { bytes, type } = await download(row.source_url);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const key = `cms/legacy/${brand}/${sha256}.${extensionFor(row.mime || type, row.file_name)}`;
      const exists = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })).then(() => true, () => false);
      if (exists) summary.already_in_s3++;
      else await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: row.mime || type || "application/octet-stream", CacheControl: "public, max-age=31536000, immutable" }));
      const { error: updateError } = await writer!.from("cms_media_files").update({ status: "stored", sha256, s3_key: key, stored_bytes: bytes.length, stored_at: new Date().toISOString(), error: null }).match(match);
      if (updateError) throw new Error(`catalog update: ${updateError.message}`);
      summary.stored++; summary.bytes += bytes.length;
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      summary.failed++; if (summary.failures.length < 40) summary.failures.push(`${row.file_name}: ${reason}`);
      await writer!.from("cms_media_files").update({ status: "failed", error: reason }).match(match);
    }
  }

  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => { while (next < rows.length) await copy(rows[next++]); }));
  log(JSON.stringify(summary, null, 2));
  return summary;
}

const invokedDirectly = process.argv[1] && /wa-gallery-import\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) runGalleryImport(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
