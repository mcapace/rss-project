#!/usr/bin/env node
/**
 * Automated asset extraction and optimization. Finds legacy image URLs inside
 * stored bodies, downloads the originals from the allowed legacy hosts, stores
 * them content-addressed in S3 (cms/legacy/<brand>/<sha256>.<ext>), writes
 * WebP and AVIF renditions at three widths, detects a focal point, attaches
 * the image to the document's media list and rewrites the body to the stable
 * /api/media URL. Dry-run by default.
 *
 *   node --import tsx scripts/rehost-media.ts --brand ws --hosts www.winespectator.com,cdn.winespectator.com
 *   node --import tsx scripts/rehost-media.ts --brand ws --hosts ... --apply --development-target <host>
 *
 * Apply also needs AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET.
 */
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { detectFocalPoint, renderRendition, RENDITION_WIDTHS } from "../src/lib/media/renditions";
import type { CmsJsonObject } from "../src/lib/cms/types";
import { brandFlag, connectReader, connectTarget } from "./lib/target";

const IMG = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };

export function legacyImageUrls(html: string, hosts: string[]): string[] {
  const out = new Set<string>();
  for (const match of html.matchAll(IMG)) {
    try {
      const url = new URL(match[1]);
      if ((url.protocol === "https:" || url.protocol === "http:") && hosts.includes(url.hostname.toLowerCase())) out.add(url.toString());
    } catch { /* relative or invalid: not a legacy host */ }
  }
  return [...out];
}

export async function runRehost(args: string[], log: (line: string) => void = console.log) {
  const { values } = parseArgs({ args, options: {
    brand: { type: "string", default: "wa" }, hosts: { type: "string", default: "" }, limit: { type: "string", default: "200" },
    apply: { type: "boolean", default: false }, "development-target": { type: "string" }, help: { type: "boolean", default: false },
  }, strict: true });
  if (values.help) { log("Usage: rehost-media --brand ws --hosts host1,host2 [--limit N] [--apply --development-target HOST]"); return; }
  const brand = brandFlag(values.brand);
  const hosts = values.hosts.split(",").map(host => host.trim().toLowerCase()).filter(Boolean);
  if (!hosts.length) throw new Error("--hosts lists the legacy image hosts that may be fetched; nothing else is downloaded.");
  const limit = Math.min(5000, Math.max(1, Number(values.limit) || 200));
  const reader = connectReader();
  const writer = connectTarget(values);
  const bucket = process.env.S3_BUCKET;
  if (writer && !bucket) throw new Error("Apply needs S3_BUCKET and AWS credentials.");
  const s3 = writer ? new S3Client({ region: process.env.AWS_REGION || "us-east-1" }) : null;

  // Only documents that still point at one of the legacy hosts, so repeated passes make progress.
  const { data, error } = await reader.from("cms_documents").select("id,title,body_html,metadata,revision").eq("brand", brand)
    .or(hosts.map(host => `body_html.ilike.%${host.replace(/[%_,()]/g, "")}%`).join(",")).order("updated_at", { ascending: true }).limit(limit);
  if (error) throw new Error(`Could not read documents: ${error.message}`);
  const summary = { mode: writer ? "development-apply" : "dry-run", brand, documents: 0, images_found: 0, images_rehosted: 0, renditions: 0, bodies_rewritten: 0, failures: [] as string[] };

  for (const row of (data ?? []) as { id: string; title: string; body_html: string; metadata: CmsJsonObject; revision: number }[]) {
    const urls = legacyImageUrls(row.body_html, hosts);
    if (!urls.length) continue;
    summary.documents += 1; summary.images_found += urls.length;
    if (!writer || !s3 || !bucket) continue;
    const media = Array.isArray(row.metadata.media) ? [...(row.metadata.media as CmsJsonObject[])] : [];
    let html = row.body_html;
    for (const url of urls) {
      try {
        const response = await fetch(url, { headers: { "User-Agent": "mshanken-cms-migration/1.0" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const type = (response.headers.get("content-type") ?? "").split(";")[0].trim();
        if (!EXT[type]) throw new Error(`unsupported type ${type || "unknown"}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 40 * 1024 * 1024) throw new Error("larger than 40 MB");
        const sha = createHash("sha256").update(bytes).digest("hex");
        const key = `cms/legacy/${brand}/${sha}.${EXT[type]}`;
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: type, CacheControl: "public, max-age=31536000, immutable" }));
        const renditions: Record<string, string> = {};
        for (const width of RENDITION_WIDTHS) {
          for (const format of ["webp", "avif"] as const) {
            const rendition = await renderRendition(bytes, { width, format });
            const renditionKey = `cms/legacy/${brand}/${sha}-${width}.${format}`;
            await s3.send(new PutObjectCommand({ Bucket: bucket, Key: renditionKey, Body: rendition.body, ContentType: rendition.contentType, CacheControl: "public, max-age=31536000, immutable" }));
            renditions[`${width}.${format}`] = renditionKey;
            summary.renditions += 1;
          }
        }
        const focal = await detectFocalPoint(bytes);
        const index = media.push({ s3_key: key, sha256: sha, file: new URL(url).pathname.split("/").pop() ?? sha, source_url: url, focal, renditions, caption: "", credit: "", alt: "" }) - 1;
        html = html.split(url).join(`/api/media/${row.id}/${index}?w=1600`);
        summary.images_rehosted += 1;
      } catch (failure) { summary.failures.push(`${row.id} ${url}: ${failure instanceof Error ? failure.message : "failed"}`); }
    }
    if (html !== row.body_html) {
      const { error: saveError } = await writer.rpc("cms_save_document", { p_document_id: row.id, p_expected_revision: row.revision, p_patch: { body_html: html, metadata: { media } }, p_actor: "media-rehost" });
      if (saveError) summary.failures.push(`${row.id}: ${saveError.message}`); else summary.bodies_rewritten += 1;
    }
  }
  log(JSON.stringify(summary, null, 2));
}

if (/(?:^|[/\\])rehost-media\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  runRehost(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : "Re-hosting failed."); process.exitCode = 1; });
}
