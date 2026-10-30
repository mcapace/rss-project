#!/usr/bin/env node
/**
 * Text structure normalization: turn stored body_html (legacy XML/HTML
 * exports, print backups, pasted markup) into the structured block document
 * (body_json) and a clean HTML rendering of it. Dry-run by default; --apply
 * writes body_json through cms_set_body_json (no editorial revision) and, with
 * --rewrite-html, also saves the normalized HTML as an editorial revision.
 *
 *   node --import tsx scripts/normalize-bodies.ts --brand wa [--limit 500] [--only-missing]
 *   node --import tsx scripts/normalize-bodies.ts --brand wa --apply --development-target <host>
 */
import { parseArgs } from "node:util";
import { blockSummary, documentToHtml, htmlToDocument } from "../src/lib/cms/blocks";
import { sanitizeCmsHtml } from "../src/lib/cms/html";
import { brandFlag, connectReader, connectTarget } from "./lib/target";

export async function runNormalize(args: string[], log: (line: string) => void = console.log) {
  const { values } = parseArgs({ args, options: {
    brand: { type: "string", default: "wa" }, limit: { type: "string", default: "500" }, "only-missing": { type: "boolean", default: true },
    "rewrite-html": { type: "boolean", default: false }, apply: { type: "boolean", default: false }, "development-target": { type: "string" }, help: { type: "boolean", default: false },
  }, strict: true });
  if (values.help) { log("Usage: normalize-bodies --brand wa [--limit N] [--rewrite-html] [--apply --development-target HOST]"); return; }
  const brand = brandFlag(values.brand);
  const limit = Math.min(5000, Math.max(1, Number(values.limit) || 500));
  const reader = connectReader();
  const writer = connectTarget(values);
  let query = reader.from("cms_documents").select("id,title,body_html,body_json,revision").eq("brand", brand).order("updated_at", { ascending: false }).limit(limit);
  if (values["only-missing"]) query = query.is("body_json", null);
  const { data, error } = await query;
  if (error) throw new Error(`Could not read documents: ${error.message}`);
  const summary = { brand, scanned: 0, normalized: 0, written: 0, html_rewritten: 0, blocks: {} as Record<string, number>, failures: [] as string[] };
  for (const row of (data ?? []) as { id: string; title: string; body_html: string; body_json: unknown; revision: number }[]) {
    summary.scanned += 1;
    try {
      const document = htmlToDocument(sanitizeCmsHtml(row.body_html ?? ""));
      for (const [type, count] of Object.entries(blockSummary(document))) summary.blocks[type] = (summary.blocks[type] ?? 0) + count;
      summary.normalized += 1;
      if (!writer) continue;
      const { error: setError } = await writer.rpc("cms_set_body_json", { p_document_id: row.id, p_body_json: document });
      if (setError) { summary.failures.push(`${row.id}: ${setError.message}`); continue; }
      summary.written += 1;
      if (values["rewrite-html"]) {
        const html = documentToHtml(document);
        if (html !== row.body_html) {
          const { error: saveError } = await writer.rpc("cms_save_document", { p_document_id: row.id, p_expected_revision: row.revision, p_patch: { body_html: html, body_json: document }, p_actor: "normalizer" });
          if (saveError) summary.failures.push(`${row.id}: ${saveError.message}`); else summary.html_rewritten += 1;
        }
      }
    } catch (failure) { summary.failures.push(`${row.id}: ${failure instanceof Error ? failure.message : "normalization failed"}`); }
  }
  log(JSON.stringify({ mode: writer ? "development-apply" : "dry-run", ...summary }, null, 2));
}

if (/(?:^|[/\\])normalize-bodies\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  runNormalize(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : "Normalization failed."); process.exitCode = 1; });
}
