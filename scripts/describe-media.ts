#!/usr/bin/env node
/**
 * Gives attached images the description the asset search runs on: what is in
 * the picture, its style, mood, colors and subjects, written by Claude from a
 * short-lived signed URL of the stored original. Lead photographs first, then
 * the rest. Dry-run by default; apply writes `vision` onto each media item.
 *
 *   node --import tsx scripts/describe-media.ts --brand wa --limit 200
 *   node --import tsx scripts/describe-media.ts --brand wa --limit 200 --apply --development-target <host>
 *
 * Apply needs ANTHROPIC_API_KEY, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET.
 */
import { parseArgs } from "node:util";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import Anthropic from "@anthropic-ai/sdk";
import type { CmsJsonObject } from "../src/lib/cms/types";
import { brandFlag, connectReader, connectTarget } from "./lib/target";

const MODEL = process.env.DESCRIBE_MODEL || "claude-sonnet-5-5";
const SCHEMA = { type: "object", additionalProperties: false, required: ["description", "subjects", "style", "mood", "colors", "tags"], properties: {
  description: { type: "string" }, subjects: { type: "array", items: { type: "string" } }, style: { type: "string" }, mood: { type: "string" },
  colors: { type: "array", items: { type: "string" } }, tags: { type: "array", items: { type: "string" } } } };

export async function runDescribe(args: string[], log: (line: string) => void = console.log) {
  const { values } = parseArgs({ args, options: {
    brand: { type: "string", default: "wa" }, limit: { type: "string", default: "100" }, "leads-only": { type: "boolean", default: false },
    apply: { type: "boolean", default: false }, "development-target": { type: "string" }, help: { type: "boolean", default: false },
  }, strict: true });
  if (values.help) { log("Usage: describe-media --brand wa [--limit N] [--leads-only] [--apply --development-target HOST]"); return; }
  const brand = brandFlag(values.brand);
  const limit = Math.min(2000, Math.max(1, Number(values.limit) || 100));
  const reader = connectReader();
  const writer = connectTarget(values);
  const bucket = process.env.S3_BUCKET;
  if (writer && (!bucket || !process.env.ANTHROPIC_API_KEY)) throw new Error("Apply needs S3_BUCKET, AWS credentials and ANTHROPIC_API_KEY.");
  const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
  const anthropic = writer ? new Anthropic() : null;

  // Documents with attached images that have no description yet; the newest first so the live site's stories come first.
  const { data, error } = await reader.from("cms_documents").select("id,title,metadata,revision").eq("brand", brand)
    .not("metadata->media", "is", null).not("metadata->media", "cs", JSON.stringify([{ vision: {} }]))
    .order("updated_at", { ascending: false }).limit(limit * 3);
  if (error) throw new Error(`Could not read documents: ${error.message}`);
  const summary = { mode: writer ? "development-apply" : "dry-run", brand, model: MODEL, documents: 0, images_pending: 0, images_described: 0, failures: [] as string[] };

  for (const row of (data ?? []) as { id: string; title: string; metadata: CmsJsonObject; revision: number }[]) {
    if (summary.documents >= limit) break;
    const media = Array.isArray(row.metadata.media) ? [...(row.metadata.media as CmsJsonObject[])] : [];
    const pending = media.map((item, index) => ({ item, index })).filter(({ item }) => typeof item.s3_key === "string" && !(item.vision && typeof item.vision === "object"))
      .filter(({ item }) => !values["leads-only"] || item.is_lead === true)
      .sort((a, b) => Number(b.item.is_lead === true) - Number(a.item.is_lead === true));
    if (!pending.length) continue;
    summary.documents += 1; summary.images_pending += pending.length;
    if (!writer || !anthropic || !bucket) continue;
    let changed = false;
    for (const { item, index } of pending) {
      try {
        const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: item.s3_key as string }), { expiresIn: 300 });
        const message = await anthropic.messages.create({
          model: MODEL, max_tokens: 1200,
          output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
          system: "Describe magazine images for an editorial asset search. Be literal about what is visible and precise about the look: composition, lighting, color palette, texture, setting, era, photographic or illustrative style. Name bottles, brands, places and people only when legible. Keep the description under 60 words; subjects, colors and tags are short lowercase phrases.",
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "url", url } },
            { type: "text", text: `Publication: ${brand}. Story: ${row.title}. Existing caption: ${typeof item.caption === "string" && item.caption ? item.caption : "none"}.` },
          ] }],
        });
        const text = message.content.map(block => (block.type === "text" ? block.text : "")).join("");
        const vision = JSON.parse(text) as Record<string, unknown>;
        media[index] = { ...item, vision: { ...vision, described_at: new Date().toISOString(), model: message.model } };
        changed = true; summary.images_described += 1;
      } catch (failure) { summary.failures.push(`${row.id} #${index}: ${failure instanceof Error ? failure.message : "failed"}`); }
    }
    if (changed) {
      const { error: saveError } = await writer.rpc("cms_save_document", { p_document_id: row.id, p_expected_revision: row.revision, p_patch: { metadata: { media } }, p_actor: "media-describe" });
      if (saveError) summary.failures.push(`${row.id}: ${saveError.message}`);
    }
  }
  log(JSON.stringify(summary, null, 2));
}

if (/(?:^|[/\\])describe-media\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  runDescribe(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
}
