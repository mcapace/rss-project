#!/usr/bin/env node
/**
 * Points every link to an old whiskyadvocate.com page straight at its page on this site, so nothing in a story
 * depends on the legacy host. Each path goes through the redirect map (cms_redirects: target_path, else the
 * document's canonical path when it is published), then a few known families (Top 20 years, tags, glossary,
 * WhiskyFest), then a published slug that matches the path's last segment. A link that matches nothing is
 * unwrapped: the words stay, the dead link goes. Absolute whiskyadvocate.com/api/media pictures become relative.
 *
 * Covers published story bodies in the CMS and, with --static, the JSON files the static pages read.
 *
 *   node --import tsx scripts/wa-rewrite-legacy-links.ts [--static]
 *   node --import tsx scripts/wa-rewrite-legacy-links.ts --apply --development-target <host> [--static]
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePath } from "../src/lib/cms/redirects";
import { decodeEntities, sniffImageType } from "./rehost-media";
import { connectReader, connectTarget } from "./lib/target";

const WORDPRESS_UPLOADS = "https://mscwordpresscontent.s3.amazonaws.com/wa";
const FILE_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif" };

const LEGACY = String.raw`(?:https?:)?\/\/(?:www\.)?whiskyadvocate\.com`;
/** An anchor to a legacy page, captured as: opening tag before href, the path, the rest of the tag, the inner HTML. */
const ANCHOR = new RegExp(String.raw`<a\b([^>]*?)\shref=(["'])${LEGACY}(\/(?:(?!\2)[^>])*)?\2([^>]*)>([\s\S]*?)<\/a>`, "gi");
const MEDIA = new RegExp(String.raw`(\s(?:src|srcset)=["'])${LEGACY}(\/api\/media\/)`, "gi");
const STATIC_FILES = ["top20.json", "ninety.json", "glossary.json", "cocktails.json", "videos.json"];

export type LinkMap = { redirects: Map<string, string | null>; slugs: Map<string, string> };

/** The new href for a legacy path, or null when nothing on this site answers for it. */
export function resolveLegacyPath(raw: string, map: LinkMap): string | null {
  let value = decodeEntities(raw || "/");
  try { value = decodeURI(value); } catch { /* keep as written */ }
  value = value.replace(/https?:\/\/.*$/i, "").replace(/[\s\\]+$/g, "");
  const p = normalizePath(value);
  if (p === "/") return "/wa/";
  const direct = map.redirects.get(p);
  if (direct) return direct;
  if (p === "/search") {
    const q = new URLSearchParams(value.split("?")[1] ?? "").get("q");
    return q ? `/wa/finder.html?q=${encodeURIComponent(q)}` : "/wa/finder.html";
  }
  if (p === "/tools") return "/wa/tools.html";
  const year = /^\/top20(?:\/top20)?(?:\/(\d{4}))?(?:\/|$)/.exec(p);
  if (year) return year[1] ? `/wa/top20.html#${year[1]}` : "/wa/top20.html";
  if (/^\/(?:events\/)?whiskyfest(?:-|\/|$)/.test(p)) return "https://www.whiskyfest.com/";
  if (/^\/glossary(?:\/|$)/.test(p)) return "/wa/guides.html";
  if (/^\/ratings-(?:r|and-reviews)/.test(p)) return "/wa/finder.html";
  if (/^\/(?:tag|category|magazine|site)(?:\/|$)/.test(p)) return "/wa/stories.html";
  const last = p.split("/").filter(Boolean).pop() ?? "";
  for (const candidate of [last, last.replace(/-exist$/, "")]) {
    const fromMap = map.redirects.get(`/${candidate}`);
    if (fromMap) return fromMap;
    const slug = map.slugs.get(candidate);
    if (slug) return slug;
  }
  return null;
}

/** The body with legacy page links pointed here (or unwrapped) and legacy-host media made relative. */
export function rewriteLegacyLinks(html: string, map: LinkMap, misses?: Map<string, number>): { html: string; changed: number } {
  let changed = 0;
  const out = html
    .replace(ANCHOR, (_whole, before: string, quote: string, rawPath: string | undefined, after: string, inner: string) => {
      changed++;
      const target = resolveLegacyPath(rawPath ?? "/", map);
      if (target) return `<a${before} href=${quote}${target}${quote}${after}>${inner}</a>`;
      misses?.set(rawPath ?? "/", (misses.get(rawPath ?? "/") ?? 0) + 1);
      return inner;
    })
    .replace(MEDIA, (_whole, attr: string, api: string) => { changed++; return attr + api; });
  return { html: out, changed };
}

async function pageAll<T>(fetchPage: (from: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await fetchPage(from);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

export async function loadLinkMap(db: SupabaseClient): Promise<LinkMap> {
  type Doc = { id: string; slug: string | null; publication_state: string; canonical: string | null };
  const docs = await pageAll<Doc>(from => db.from("cms_documents").select("id,slug,publication_state,canonical:metadata->>canonical_path").eq("brand", "wa").order("id").range(from, from + 999));
  const byId = new Map(docs.map(doc => [doc.id, doc]));
  const canonical = (doc: Doc | undefined) => doc && doc.publication_state === "published" ? (doc.canonical?.startsWith("/") ? doc.canonical : doc.slug ? `/wa/${doc.slug}` : null) : null;
  const slugs = new Map<string, string>();
  for (const doc of docs) { const target = canonical(doc); if (target && doc.slug) slugs.set(doc.slug.toLowerCase(), target); }
  type Row = { legacy_host: string | null; legacy_path: string; target_path: string | null; document_id: string | null; status: number };
  const rows = await pageAll<Row>(from => db.from("cms_redirects").select("legacy_host,legacy_path,target_path,document_id,status").eq("brand", "wa").order("id").range(from, from + 999));
  const redirects = new Map<string, string | null>();
  // Host-specific rows win over host-less ones, as in cms_resolve_redirect.
  for (const row of rows.sort((a, b) => Number(Boolean(a.legacy_host)) - Number(Boolean(b.legacy_host)))) {
    if (row.legacy_host && !/^(?:www\.)?whiskyadvocate\.com$/i.test(row.legacy_host)) continue;
    const target = row.status === 410 ? null : row.target_path ?? canonical(row.document_id ? byId.get(row.document_id) : undefined);
    redirects.set(normalizePath(row.legacy_path), target);
  }
  return { redirects, slugs };
}

async function main() {
  const { values } = parseArgs({ options: {
    apply: { type: "boolean", default: false }, "development-target": { type: "string" }, static: { type: "boolean", default: false },
  }, strict: true });
  const reader = connectReader();
  const writer = connectTarget(values);
  const map = await loadLinkMap(reader);
  const misses = new Map<string, number>();
  const summary = { mode: writer ? "apply" : "dry-run", redirects: map.redirects.size, documents: 0, links: 0, saved: 0, files: 0, uploads: 0, failures: [] as string[] };

  type Row = { id: string; body_html: string; revision: number };
  const rows: Row[] = [];
  let after = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const { data, error } = await reader.from("cms_documents").select("id,body_html,revision").eq("brand", "wa").eq("publication_state", "published").gt("id", after).order("id").limit(200);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as Row[];
    if (!page.length) break;
    after = page[page.length - 1].id;
    rows.push(...page.filter(row => row.body_html && /whiskyadvocate\.com/i.test(row.body_html)));
  }
  const statics: { file: string; text: string }[] = [];
  if (values.static) {
    for (const name of STATIC_FILES) {
      const file = path.join(process.cwd(), "public", "wa", name);
      const text = await readFile(file, "utf8").catch(() => null);
      if (text !== null && /whiskyadvocate\.com/i.test(text)) statics.push({ file, text });
    }
  }

  // Files the old WordPress uploads held (PDF toolkits, pictures) come from its S3 copy and are served from ours.
  const uploads = new Set<string>();
  for (const text of [...rows.map(row => row.body_html), ...statics.map(s => s.text)]) {
    for (const match of text.matchAll(new RegExp(String.raw`${LEGACY}(\/wp-content\/uploads\/[^"'\\?#\s]+)`, "gi"))) uploads.add(decodeEntities(match[1]));
  }
  const bucket = process.env.S3_BUCKET;
  if (writer && uploads.size && !bucket) throw new Error("Apply needs S3_BUCKET and AWS credentials to re-host the old uploads.");
  const s3 = writer ? new S3Client({ region: process.env.AWS_REGION || "us-east-1" }) : null;
  for (const upload of uploads) {
    try {
      const response = await fetch(`${WORDPRESS_UPLOADS}${encodeURI(upload)}`, { headers: { "User-Agent": "mshanken-cms-migration/1.0" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const ext = new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-" ? "pdf" : FILE_EXT[sniffImageType(bytes) ?? ""];
      if (!ext) throw new Error("neither a PDF nor a picture");
      const name = `${createHash("sha256").update(bytes).digest("hex")}.${ext}`;
      if (s3) await s3.send(new PutObjectCommand({ Bucket: bucket, Key: `cms/legacy/wa/${name}`, Body: bytes, ContentType: ext === "pdf" ? "application/pdf" : `image/${ext === "jpg" ? "jpeg" : ext}`, CacheControl: "public, max-age=31536000, immutable" }));
      map.redirects.set(normalizePath(upload), `/api/wa/asset/${name}`);
      summary.uploads++;
    } catch (error) {
      summary.failures.push(`${upload}: ${error instanceof Error ? error.message : error}`);
    }
  }

  for (const row of rows) {
    const result = rewriteLegacyLinks(row.body_html, map, misses);
    if (!result.changed || result.html === row.body_html) continue;
    summary.documents++;
    summary.links += result.changed;
    if (!writer) continue;
    const { error: saveError } = await writer.rpc("cms_save_document", { p_document_id: row.id, p_expected_revision: row.revision, p_patch: { body_html: result.html }, p_actor: "agent:legacy-links-2026-11-01" });
    if (saveError) summary.failures.push(`${row.id}: ${saveError.message}`); else summary.saved++;
  }

  for (const { file, text } of statics) {
    // Rewrite string literals one at a time so the rest of each file keeps its exact formatting.
    let changed = 0;
    const next = text.replace(/"(?:[^"\\]|\\.)*"/g, literal => {
      if (!/whiskyadvocate\.com/i.test(literal)) return literal;
      const value = JSON.parse(literal) as string;
      let out = rewriteLegacyLinks(value, map, misses);
      // A bare URL value (a link field rather than HTML).
      const bare = new RegExp(String.raw`^${LEGACY}(\/[^\s"']*)?$`, "i").exec(out.html);
      if (bare) { const target = resolveLegacyPath(bare[1] ?? "/", map); if (target) out = { html: target, changed: 1 }; }
      if (out.html === value) return literal;
      changed += Math.max(1, out.changed);
      return JSON.stringify(out.html);
    });
    JSON.parse(next);
    if (!changed) continue;
    summary.files++;
    summary.links += changed;
    if (writer) await writeFile(file, next, "utf8");
  }

  console.log(JSON.stringify({ ...summary, unresolved: misses.size, unresolved_sample: [...misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40) }, null, 2));
}

if (/(?:^|[/\\])wa-rewrite-legacy-links\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
}
