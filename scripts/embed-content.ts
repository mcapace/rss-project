#!/usr/bin/env node
/**
 * Semantic index backfill: embed every document (and described image) that
 * has no embedding or has changed since it was embedded. Needs VOYAGE_API_KEY.
 *
 *   node --import tsx scripts/embed-content.ts --brand wa [--limit 200]
 *   node --import tsx scripts/embed-content.ts --brand wa --apply --development-target <host>
 */
import { parseArgs } from "node:util";
import type { CmsJsonObject } from "../src/lib/cms/types";
import { embeddingsConfigured, mediaEmbeddingText, upsertDocumentEmbedding, upsertMediaEmbedding } from "../src/lib/editorial/server/embeddings";
import { brandFlag, connectReader, connectTarget } from "./lib/target";

export async function runEmbed(args: string[], log: (line: string) => void = console.log) {
  const { values } = parseArgs({ args, options: {
    brand: { type: "string", default: "wa" }, limit: { type: "string", default: "200" },
    apply: { type: "boolean", default: false }, "development-target": { type: "string" }, help: { type: "boolean", default: false },
  }, strict: true });
  if (values.help) { log("Usage: embed-content --brand wa [--limit N] [--apply --development-target HOST]"); return; }
  const brand = brandFlag(values.brand);
  const limit = Math.min(500, Math.max(1, Number(values.limit) || 200));
  const reader = connectReader();
  const writer = connectTarget(values);
  const { data, error } = await reader.rpc("cms_embedding_backlog", { p_brands: [brand], p_limit: limit });
  if (error) throw new Error(`Could not read the backlog: ${error.message}`);
  const backlog = (data ?? []) as { document_id: string; title: string }[];
  const summary = { mode: writer ? "development-apply" : "dry-run", brand, backlog: backlog.length, configured: embeddingsConfigured(), documents_embedded: 0, images_embedded: 0, failures: [] as string[] };
  if (writer) {
    if (!embeddingsConfigured()) throw new Error("Set VOYAGE_API_KEY to embed content.");
    for (const item of backlog) {
      const { data: row, error: readError } = await reader.from("cms_documents").select("id,title,excerpt,body_html,metadata").eq("id", item.document_id).single();
      if (readError || !row) { summary.failures.push(`${item.document_id}: ${readError?.message ?? "missing"}`); continue; }
      try {
        if (await upsertDocumentEmbedding(writer, row)) summary.documents_embedded += 1;
        const media = Array.isArray(row.metadata?.media) ? (row.metadata.media as CmsJsonObject[]) : [];
        for (const [index, media_item] of media.entries()) {
          if (!mediaEmbeddingText(media_item)) continue;
          if (await upsertMediaEmbedding(writer, row.id, index, media_item)) summary.images_embedded += 1;
        }
      } catch (failure) { summary.failures.push(`${item.document_id}: ${failure instanceof Error ? failure.message : "failed"}`); }
    }
  }
  log(JSON.stringify(summary, null, 2));
}

if (/(?:^|[/\\])embed-content\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  runEmbed(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : "Embedding failed."); process.exitCode = 1; });
}
