#!/usr/bin/env node
/**
 * Gives every file in the gallery library a web name: an SEO file name, a title,
 * alt text, a short description and keywords, so editors can find any picture by
 * what it shows and the site can serve it under a name search engines and AI answer
 * engines read (/api/wa/asset/<web-name>-<sha256>.jpg).
 *
 * Claude looks at the picture itself (resized to 768 px) with the clues the old site
 * left: the Morweb file name, its gallery, its Morweb alt text and the titles of the
 * stories that use it. Files that are not pictures (PDFs, videos, archives) and the
 * rare picture that cannot be decoded are named from those clues alone. A file kept in
 * several galleries is named once and the name is written to every copy.
 *
 * Naming conventions (SEO and GEO, for the web):
 *   - file name: lowercase ASCII words joined by hyphens, 3 to 8 words, at most 60
 *     characters, the most specific identifier first (brand, expression, age or
 *     edition, then subject and kind of shot); no filler (image, photo, hero, 300,
 *     final, copy), no sizes, no stuffing.
 *   - title: at most 70 characters, sentence case.
 *   - alt text: one sentence, at most 125 characters, what is visible and why it
 *     matters; never "image of".
 *   - description: one or two factual sentences, at most 300 characters, quotable by
 *     an answer engine.
 *   - keywords: 4 to 10 lowercase phrases readers would search for.
 *
 * Dry-run by default (counts what is left). --preview N names N files and prints the
 * result without writing. --apply writes cms_media_files.seo_* and keywords; a file
 * that cannot be named is marked attempted with the reason (ai.error) so a pass moves
 * on, and --retry-failed tries those again.
 *
 *   node --import tsx scripts/wa-media-name.ts --brand wa
 *   node --import tsx scripts/wa-media-name.ts --brand wa --preview 12
 *   node --import tsx scripts/wa-media-name.ts --brand wa --limit 400 --apply --development-target <host>
 *
 * Needs ANTHROPIC_API_KEY and S3 access (AWS_REGION, AWS_ACCESS_KEY_ID,
 * AWS_SECRET_ACCESS_KEY, S3_BUCKET) to preview or apply. MEDIA_NAME_MODEL picks
 * the model (default claude-opus-5-5).
 */
import { parseArgs } from "node:util";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { brandFlag, connectReader, connectTarget } from "./lib/target";

const MODEL = process.env.MEDIA_NAME_MODEL || "claude-opus-5-5";
const KINDS = ["bottle", "bottle-group", "label", "packaging", "cocktail", "food", "person", "group", "distillery", "still-room", "warehouse-barrels", "landscape", "bar", "event", "tasting", "logo", "graphic", "illustration", "chart", "map", "document", "ad", "screenshot", "video", "other"] as const;
const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["seo_slug", "title", "alt", "description", "keywords", "kind", "brand", "product", "visible_text"],
  properties: {
    seo_slug: { type: "string" }, title: { type: "string" }, alt: { type: "string" }, description: { type: "string" },
    keywords: { type: "array", items: { type: "string" } }, kind: { type: "string", enum: [...KINDS] },
    brand: { type: "string" }, product: { type: "string" }, visible_text: { type: "string" },
  },
} as const;

const SYSTEM = `You name image files for whiskyadvocate.com, the magazine of record for whisky, so editors, search engines and AI answer engines can find and understand each one. Return JSON with:
- seo_slug: the web file name without extension. Lowercase ASCII words joined by single hyphens, 3 to 8 words, at most 60 characters. Lead with the most specific identifier: brand, product or expression, age, edition or year, then the subject and the kind of shot (bottle, label, distillery, warehouse, portrait, cocktail, tasting). Name a person or place only when the picture, file name, gallery or story establishes it. Never use filler (image, photo, picture, pic, file, final, copy, hero, banner, thumb, web, new) or pixel sizes such as 300 or 600, and never repeat a word.
- title: a short human title, at most 70 characters, sentence case.
- alt: alt text for a screen reader, one sentence, at most 125 characters, saying what is visible and what matters about it here. Do not begin with "image of", "photo of" or "picture of".
- description: one or two plain factual sentences, at most 300 characters, saying what the picture shows and its context (brand, product, place, person, event), written so an answer engine could quote it.
- keywords: 4 to 10 lowercase phrases readers would search for, most specific first.
- kind: the closest kind from the list.
- brand and product: as printed on the label or established by the clues, else an empty string.
- visible_text: legible label or sign text, at most 120 characters, else an empty string.
Use the file name, gallery, existing alt text and story titles as clues, but say only what the picture and clues support; when the picture and the file name disagree, trust the picture. Write plainly: no marketing language, no em dashes, no quotation marks around values.`;

/** Words that carry no meaning in a web file name. */
const FILLER = new Set(["image", "images", "img", "photo", "photos", "picture", "pic", "pics", "file", "final", "copy", "hero", "banner", "thumb", "thumbnail", "web", "new", "edit", "edited", "version", "v1", "v2", "v3", "large", "small", "the", "a", "an", "of", "and", "jpg", "jpeg", "png", "tif", "tiff", "gif", "webp"]);

/** A web file name from any text: lowercase ASCII, hyphens, no filler or pixel sizes, no repeats, at most `max` characters on a word boundary. */
export function slugify(input: string, max = 60): string {
  const words = input.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/['’]/g, "").toLowerCase()
    .split(/[^a-z0-9]+/).filter(word => word && !FILLER.has(word) && !/^\d{3,4}(px|x\d+)?$/.test(word) && !/^\d+x\d+$/.test(word));
  const out: string[] = [];
  for (const word of words) {
    if (out.includes(word)) continue;
    if ([...out, word].join("-").length > max) break;
    out.push(word);
  }
  return out.join("-");
}

/** Cut text to `max` characters on a word, without a dangling separator. */
export function clip(input: string, max: number): string {
  const text = input.replace(/\s*[—–]\s*/g, ", ").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const end = cut.lastIndexOf(" ");
  return (end > max * 0.6 ? cut.slice(0, end) : cut.slice(0, max)).replace(/[\s,;:–-]+$/, "");
}

export type Named = { seo_name: string; seo_title: string; seo_alt: string; seo_description: string; keywords: string[]; kind: string; brand: string; product: string; visible_text: string };

/** Tidy what the model returned to the conventions, falling back to the original file name for the web name. */
export function tidy(raw: Record<string, unknown>, fileName: string): Named {
  const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const fallback = slugify(fileName.replace(/\.[a-z0-9]{2,5}$/i, ""));
  const seo = slugify(str(raw.seo_slug)) || fallback || "whisky-advocate-file";
  const alt = clip(str(raw.alt).replace(/^(an?\s+)?(image|photo|picture|photograph)\s+of\s+/i, ""), 125);
  const keywords = [...new Set((Array.isArray(raw.keywords) ? raw.keywords : []).map(k => clip(str(k).toLowerCase(), 40)).filter(Boolean))].slice(0, 10);
  return {
    seo_name: seo, seo_title: clip(str(raw.title), 70), seo_alt: alt ? alt[0].toUpperCase() + alt.slice(1) : "", seo_description: clip(str(raw.description), 300), keywords,
    kind: (KINDS as readonly string[]).includes(str(raw.kind)) ? str(raw.kind) : "other", brand: clip(str(raw.brand), 80), product: clip(str(raw.product), 120), visible_text: clip(str(raw.visible_text), 120),
  };
}

type Row = { source_gallery_id: string; file_name: string; alt: string; mime: string; width: number | null; height: number | null; sha256: string; s3_key: string };

/** A 768 px JPEG of the picture for the model, or null when it cannot be decoded (HEIC, broken files). */
async function preview(bytes: Uint8Array): Promise<string | null> {
  try {
    const out = await sharp(bytes, { failOn: "none", limitInputPixels: 120_000_000, animated: false }).rotate()
      .resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 80 }).toBuffer();
    return out.toString("base64");
  } catch { return null; }
}

export async function runMediaName(args: string[], log: (line: string) => void = console.log) {
  const { values } = parseArgs({ args, options: {
    brand: { type: "string", default: "wa" }, limit: { type: "string", default: "300" }, concurrency: { type: "string", default: "4" },
    gallery: { type: "string" }, redo: { type: "boolean", default: false }, "retry-failed": { type: "boolean", default: false }, preview: { type: "string" },
    apply: { type: "boolean", default: false }, "development-target": { type: "string" }, help: { type: "boolean", default: false },
  }, strict: true });
  if (values.help) { log("Usage: wa-media-name --brand wa [--limit N] [--concurrency N] [--gallery ID] [--redo | --retry-failed] [--preview N] [--apply --development-target HOST]"); return; }
  const brand = brandFlag(values.brand);
  const previewCount = values.preview ? Math.min(50, Math.max(1, Number(values.preview) || 10)) : 0;
  const limit = previewCount || Math.min(2000, Math.max(1, Number(values.limit) || 300));
  const concurrency = Math.min(8, Math.max(1, Number(values.concurrency) || 4));
  const reader = connectReader();
  const writer = connectTarget(values);
  const calls = Boolean(writer || previewCount);
  const bucket = process.env.S3_BUCKET;
  if (calls && (!bucket || !process.env.ANTHROPIC_API_KEY)) throw new Error("Naming needs S3_BUCKET, AWS credentials and ANTHROPIC_API_KEY.");

  // The files still to name, one row per distinct file (the same picture can sit in several galleries).
  const which = values["retry-failed"] ? "named_at.not.is.null,seo_name.is.null" : values.redo ? null : "named_at.is.null";
  const { data, error, count } = await reader.from("cms_media_files").select("source_gallery_id,file_name,alt,mime,width,height,sha256,s3_key", { count: "exact" })
    .eq("brand", brand).eq("status", "stored").not("sha256", "is", null)
    .match(values.gallery ? { source_gallery_id: values.gallery } : {})
    .or(which ? `and(${which})` : "sha256.not.is.null")
    .order("sha256").limit(limit * 3);
  if (error) throw new Error(`Could not read the gallery catalog: ${error.message}`);
  const byHash = new Map<string, Row[]>();
  for (const row of (data ?? []) as Row[]) byHash.set(row.sha256, [...(byHash.get(row.sha256) ?? []), row]);
  const files = [...byHash.values()].slice(0, limit);
  const summary = { mode: writer ? "development-apply" : previewCount ? "preview" : "dry-run", brand, model: MODEL, rows_left: count ?? 0, documents: files.length, named: 0, from_picture: 0, from_clues: 0, failed: 0, failures: [] as string[], samples: [] as unknown[] };
  if (!calls || !files.length) { log(JSON.stringify(summary, null, 2)); return summary; }

  // Clues: gallery titles and the stories that use each file.
  const galleryIds = [...new Set(files.flat().map(row => row.source_gallery_id))];
  const { data: galleries } = await reader.from("cms_media_galleries").select("source_gallery_id,title,name").eq("brand", brand).in("source_gallery_id", galleryIds);
  const galleryTitle = new Map(((galleries ?? []) as { source_gallery_id: string; title: string; name: string }[]).map(g => [g.source_gallery_id, g.title || g.name]));
  const stories = new Map<string, string[]>();
  for (let i = 0; i < files.length; i += 200) {
    const chunk = files.slice(i, i + 200);
    const { data: used } = await reader.rpc("cms_media_file_usage", { p_brand: brand, p_sha256: chunk.map(rows => rows[0].sha256), p_names: [...new Set(chunk.flat().map(row => row.file_name.toLowerCase()))] });
    const byName = new Map(chunk.flatMap(rows => rows.map(row => [row.file_name.toLowerCase(), row.sha256] as const)));
    for (const hit of (used ?? []) as { sha256: string | null; file_name: string; title: string }[]) {
      const sha = hit.sha256 ?? byName.get(hit.file_name);
      if (!sha || !hit.title) continue;
      const list = stories.get(sha) ?? [];
      if (!list.includes(hit.title) && list.length < 4) list.push(hit.title);
      stories.set(sha, list);
    }
  }

  const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
  const anthropic = new Anthropic();

  async function name(rows: Row[]) {
    const first = rows[0];
    try {
      let image: string | null = null;
      if (/^image\//.test(first.mime) || /\.(jpe?g|png|gif|webp|tiff?|avif|heic|svg)$/i.test(first.file_name)) {
        const object = await s3.send(new GetObjectCommand({ Bucket: bucket!, Key: first.s3_key }));
        const bytes = await object.Body?.transformToByteArray();
        if (bytes) image = await preview(bytes);
      }
      const clues = [
        `File name: ${[...new Set(rows.map(row => row.file_name))].join(" | ")}`,
        `Type: ${first.mime || "unknown"}${first.width && first.height ? `, ${first.width} x ${first.height}` : ""}`,
        `Gallery: ${[...new Set(rows.map(row => galleryTitle.get(row.source_gallery_id) ?? row.source_gallery_id))].join(" | ")}`,
        `Morweb alt text: ${rows.map(row => row.alt).find(Boolean) || "none"}`,
        `Stories that use it: ${(stories.get(first.sha256) ?? []).join(" | ") || "none found"}`,
        image ? "" : "No picture is attached: name the file from these clues alone and keep the alt text and description to what they establish.",
      ].filter(Boolean).join("\n");
      const message = await anthropic.beta.messages.create({
        model: MODEL, max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
        system: SYSTEM,
        messages: [{ role: "user", content: [
          ...(image ? [{ type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: image } }] : []),
          { type: "text" as const, text: clues },
        ] }],
      });
      if (message.stop_reason === "refusal") throw new Error(`declined (${message.stop_details?.category ?? "no category"})`);
      if (message.stop_reason === "max_tokens") throw new Error("answer cut off");
      const text = message.content.map(block => (block.type === "text" ? block.text : "")).join("");
      const named = tidy(JSON.parse(text) as Record<string, unknown>, first.file_name);
      summary.named++; if (image) summary.from_picture++; else summary.from_clues++;
      if (summary.samples.length < (previewCount || 5)) summary.samples.push({ file: first.file_name, ...named });
      if (!writer) return;
      const now = new Date().toISOString();
      const { error: saveError } = await writer.from("cms_media_files").update({
        seo_name: named.seo_name, seo_title: named.seo_title, seo_alt: named.seo_alt, seo_description: named.seo_description, keywords: named.keywords,
        ai: { kind: named.kind, brand: named.brand, product: named.product, visible_text: named.visible_text, model: message.model, source: image ? "picture" : "clues", named_at: now },
        named_at: now,
      }).eq("brand", brand).eq("sha256", first.sha256);
      if (saveError) throw new Error(`catalog update: ${saveError.message}`);
    } catch (failure) {
      const reason = (failure instanceof Error ? failure.message : String(failure)).slice(0, 300);
      summary.failed++;
      if (summary.failures.length < 40) summary.failures.push(`${first.file_name}: ${reason}`);
      // Marked attempted so the next pass moves on; --retry-failed picks these up again.
      if (writer) await writer.from("cms_media_files").update({ ai: { error: reason, model: MODEL, failed_at: new Date().toISOString() }, named_at: new Date().toISOString() }).eq("brand", brand).eq("sha256", first.sha256).is("seo_name", null);
    }
  }

  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => { while (next < files.length) await name(files[next++]); }));
  log(JSON.stringify(summary, null, 2));
  return summary;
}

if (/(?:^|[/\\])wa-media-name\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  runMediaName(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
}
