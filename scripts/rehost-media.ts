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
import { figureCaptions, restoreBodyCaptions } from "../src/lib/cms/captions";
import { detectFocalPoint, renderRendition, RENDITION_WIDTHS } from "../src/lib/media/renditions";
import type { CmsJsonObject } from "../src/lib/cms/types";
import { brandFlag, connectReader, connectTarget } from "./lib/target";

const IMG = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
const ALT = /\balt=["']([^"']*)["']/i;
/** Where each publication's legacy site served its own images, so relative paths in migrated bodies can be fetched. */
export const LEGACY_BASE: Record<string, string> = { wa: "https://whiskyadvocate.com", ws: "https://www.winespectator.com", ca: "https://www.cigaraficionado.com", mw: "https://www.marketwatch.com" };
export type LegacyImage = { raw: string; url: string; alt: string };
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };

/** Legacy hosts sometimes label images application/octet-stream; the file's first bytes say what it is. */
export function sniffImageType(bytes: Uint8Array): string | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && /^avi[fs]$/.test(ascii(8, 12))) return "image/avif";
  return null;
}

export function legacyImageUrls(html: string, hosts: string[], base?: string): string[] {
  return legacyImages(html, hosts, base).map(image => image.url);
}

/** Every legacy image in a body: absolute URLs on an allowed host, and relative paths resolved against the publication's own legacy base when that host is allowed. */
export function legacyImages(html: string, hosts: string[], base?: string): LegacyImage[] {
  const out = new Map<string, LegacyImage>();
  const baseHost = base ? new URL(base).hostname.toLowerCase() : "";
  for (const match of html.matchAll(IMG)) {
    const raw = match[1];
    const alt = (ALT.exec(match[0])?.[1] ?? "").trim();
    if (raw.startsWith("/api/")) continue;
    try {
      const url = raw.startsWith("/") && !raw.startsWith("//") && base && hosts.includes(baseHost) ? new URL(raw, base) : new URL(raw);
      if ((url.protocol === "https:" || url.protocol === "http:") && hosts.includes(url.hostname.toLowerCase()) && !out.has(raw)) out.set(raw, { raw, url: url.toString(), alt });
    } catch { /* invalid: not a legacy image */ }
  }
  return [...out.values()];
}

export async function runRehost(args: string[], log: (line: string) => void = console.log) {
  const { values } = parseArgs({ args, options: {
    brand: { type: "string", default: "wa" }, hosts: { type: "string", default: "" }, limit: { type: "string", default: "200" },
    apply: { type: "boolean", default: false }, "development-target": { type: "string" }, help: { type: "boolean", default: false },
    heroes: { type: "boolean", default: false }, published: { type: "boolean", default: false },
    "skip-renditions": { type: "boolean", default: false }, concurrency: { type: "string", default: "4" },
  }, strict: true });
  if (values.help) { log("Usage: rehost-media --brand ws --hosts host1,host2 [--limit N] [--heroes] [--published] [--skip-renditions] [--concurrency N] [--apply --development-target HOST]"); return; }
  const concurrency = Math.min(32, Math.max(1, Number(values.concurrency) || 4));
  const brand = brandFlag(values.brand);
  const hosts = values.hosts.split(",").map(host => host.trim().toLowerCase()).filter(Boolean);
  if (!hosts.length) throw new Error("--hosts lists the legacy image hosts that may be fetched; nothing else is downloaded.");
  const limit = Math.min(5000, Math.max(1, Number(values.limit) || 200));
  const reader = connectReader();
  const writer = connectTarget(values);
  const bucket = process.env.S3_BUCKET;
  if (writer && !bucket) throw new Error("Apply needs S3_BUCKET and AWS credentials.");
  const s3 = writer ? new S3Client({ region: process.env.AWS_REGION || "us-east-1" }) : null;

  const base = LEGACY_BASE[brand];
  const baseAllowed = Boolean(base && hosts.includes(new URL(base).hostname.toLowerCase()));
  const summary = { mode: writer ? "development-apply" : "dry-run", brand, heroes: values.heroes, scanned: 0, documents: 0, images_found: 0, images_rehosted: 0, renditions: 0, bodies_rewritten: 0, failures: [] as string[] };
  type Row = { id: string; title: string; body_html: string; metadata: CmsJsonObject; revision: number };
  const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as CmsJsonObject : null;
  // The lead photograph, when it still lives on a legacy host and no media record carries it yet.
  const legacyLead = (row: Row): LegacyImage | null => {
    const legacy = record(row.metadata.legacy_media);
    const heroRaw = typeof legacy?.thumb_file === "string" ? legacy.thumb_file : "";
    if (!heroRaw) return null;
    try {
      const url = heroRaw.startsWith("/") && base ? new URL(heroRaw, base) : new URL(heroRaw);
      if (!hosts.includes(url.hostname.toLowerCase())) return null;
      const media = Array.isArray(row.metadata.media) ? row.metadata.media as CmsJsonObject[] : [];
      if (media.some(item => item.source_url === url.toString())) return null;
      return { raw: heroRaw, url: url.toString(), alt: row.title };
    } catch { return null; }
  };
  const pending = (row: Row) => values.heroes ? legacyLead(row) !== null : legacyImages(row.body_html ?? "", hosts, baseAllowed ? base : undefined).length > 0 || legacyLead(row) !== null;

  // Walk the table by id in small pages and test bodies here: a single ilike over every body times out.
  const rows: Row[] = [];
  let after = "00000000-0000-0000-0000-000000000000";
  while (rows.length < limit) {
    let page: Row[] | null = null;
    for (let attempt = 0; attempt < 4 && !page; attempt++) {
      let query = reader.from("cms_documents").select("id,title,body_html,metadata,revision").eq("brand", brand).gt("id", after);
      if (values.published) query = query.eq("publication_state", "published");
      const { data, error } = await query.order("id").limit(100);
      if (!error) page = data as Row[]; else if (attempt === 3) throw new Error(`Could not read documents: ${error.message}`);
    }
    if (!page?.length) break;
    after = page[page.length - 1].id;
    summary.scanned += page.length;
    rows.push(...page.filter(pending));
  }

  const rehostOne = async (row: Row) => {
    const images = values.heroes ? [] : legacyImages(row.body_html ?? "", hosts, baseAllowed ? base : undefined);
    const hero = legacyLead(row);
    if (hero && !images.some(image => image.url === hero.url)) images.push(hero);
    if (!images.length) return;
    summary.documents += 1; summary.images_found += images.length;
    if (!writer || !s3 || !bucket) return;
    const media = Array.isArray(row.metadata.media) ? [...(row.metadata.media as CmsJsonObject[])] : [];
    const before = media.length;
    const leadCaption = record(row.metadata.lead_image);
    const bodyCaptions = [...figureCaptions(row.body_html ?? ""), ...restoreBodyCaptions(row.body_html ?? "").images];
    let html = row.body_html;
    for (const image of images) {
      const url = image.url;
      if (media.some(item => item.source_url === url)) continue;
      try {
        const response = await fetch(url, { headers: { "User-Agent": "mshanken-cms-migration/1.0" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        const declared = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        const type = EXT[declared] ? declared : sniffImageType(bytes) ?? declared;
        if (!EXT[type]) throw new Error(`unsupported type ${type || "unknown"}`);
        if (bytes.length > 40 * 1024 * 1024) throw new Error("larger than 40 MB");
        const sha = createHash("sha256").update(bytes).digest("hex");
        const key = `cms/legacy/${brand}/${sha}.${EXT[type]}`;
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: type, CacheControl: "public, max-age=31536000, immutable" }));
        const renditions: Record<string, string> = {};
        // /api/media renders sizes on demand from the original, so stored renditions are optional.
        if (!values["skip-renditions"]) for (const width of RENDITION_WIDTHS) {
          for (const format of ["webp", "avif"] as const) {
            const rendition = await renderRendition(bytes, { width, format });
            const renditionKey = `cms/legacy/${brand}/${sha}-${width}.${format}`;
            await s3.send(new PutObjectCommand({ Bucket: bucket, Key: renditionKey, Body: rendition.body, ContentType: rendition.contentType, CacheControl: "public, max-age=31536000, immutable" }));
            renditions[`${width}.${format}`] = renditionKey;
            summary.renditions += 1;
          }
        }
        const focal = await detectFocalPoint(bytes);
        const isLead = hero !== null && image.url === hero.url;
        const text = isLead
          ? { caption: typeof leadCaption?.caption === "string" ? leadCaption.caption : "", credit: typeof leadCaption?.credit === "string" ? leadCaption.credit : "" }
          : bodyCaptions.find(found => found.src === image.raw) ?? { caption: "", credit: "" };
        const leadTaken = media.some(item => item.is_lead === true);
        const index = media.push({ s3_key: key, sha256: sha, file: new URL(url).pathname.split("/").pop() ?? sha, source_url: url, focal, renditions, caption: text.caption, credit: text.credit, alt: image.alt, ...(isLead && !leadTaken ? { is_lead: true } : {}) }) - 1;
        if (html.includes(image.raw)) html = html.split(image.raw).join(`/api/media/${row.id}/${index}?w=1600`);
        summary.images_rehosted += 1;
      } catch (failure) { summary.failures.push(`${row.id} ${url}: ${failure instanceof Error ? failure.message : "failed"}`); }
    }
    if (html !== row.body_html || media.length !== before) {
      const patch: CmsJsonObject = html !== row.body_html ? { body_html: html, metadata: { media } } : { metadata: { media } };
      const { error: saveError } = await writer.rpc("cms_save_document", { p_document_id: row.id, p_expected_revision: row.revision, p_patch: patch, p_actor: "media-rehost" });
      if (saveError) summary.failures.push(`${row.id}: ${saveError.message}`); else summary.bodies_rewritten += 1;
    }
  };
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => { while (next < rows.length) await rehostOne(rows[next++]); }));
  log(JSON.stringify({ ...summary, failures: summary.failures.slice(0, 100), failure_count: summary.failures.length }, null, 2));
}

if (/(?:^|[/\\])rehost-media\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  runRehost(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : "Re-hosting failed."); process.exitCode = 1; });
}
