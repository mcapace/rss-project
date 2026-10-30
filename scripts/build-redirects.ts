#!/usr/bin/env node
/**
 * Legacy URL mapping: derive 301 rows from every migrated document's public
 * URL and recorded aliases, and export them as an edge routing file. Dry-run
 * prints the plan; --apply inserts rows (existing paths are skipped);
 * --export <format> writes vercel | nginx | cloudfront | json to --out.
 *
 *   node --import tsx scripts/build-redirects.ts --brand ws --export vercel --out /private/redirects.json
 *   node --import tsx scripts/build-redirects.ts --brand ws --apply --development-target <host>
 */
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { buildRedirectRows, canonicalPath, exportRedirects, type RedirectCandidateDocument, type ResolvedRedirect } from "../src/lib/cms/redirects";
import { brandFlag, connectReader, connectTarget } from "./lib/target";

export async function runBuildRedirects(args: string[], log: (line: string) => void = console.log) {
  const { values } = parseArgs({ args, options: {
    brand: { type: "string", default: "wa" }, export: { type: "string" }, out: { type: "string" },
    apply: { type: "boolean", default: false }, "development-target": { type: "string" }, help: { type: "boolean", default: false },
  }, strict: true });
  if (values.help) { log("Usage: build-redirects --brand ws [--export vercel|nginx|cloudfront|json --out FILE] [--apply --development-target HOST]"); return; }
  const brand = brandFlag(values.brand);
  const reader = connectReader();
  const writer = connectTarget(values);
  const documents: RedirectCandidateDocument[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await reader.from("cms_documents").select("id,brand,slug,public_url,publication_state,metadata").eq("brand", brand).order("id").range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`Could not read documents: ${error.message}`);
    documents.push(...((data ?? []) as RedirectCandidateDocument[]));
    if (!data || data.length < 1000) break;
  }
  const rows = buildRedirectRows(documents);
  const resolved: ResolvedRedirect[] = rows.map(row => ({ ...row, resolved_target: row.target_path ?? canonicalPath(documents.find(doc => doc.id === row.document_id)!) }));
  const summary = { mode: writer ? "development-apply" : "dry-run", brand, documents: documents.length, redirects: rows.length, retired: rows.filter(row => row.status === 410).length, inserted: 0, skipped: 0, exported: null as string | null };
  if (writer) {
    for (const row of rows) {
      const { error } = await writer.from("cms_redirects").insert(row);
      if (error) { if (error.code === "23505") summary.skipped += 1; else throw new Error(`Insert failed for ${row.legacy_path}: ${error.message}`); }
      else summary.inserted += 1;
    }
  }
  if (values.export) {
    if (!["vercel", "nginx", "cloudfront", "json"].includes(values.export)) throw new Error("--export must be vercel, nginx, cloudfront or json.");
    if (!values.out) throw new Error("--out is required with --export; keep the file outside this repository.");
    await writeFile(values.out, exportRedirects(resolved, values.export as "vercel"), { mode: 0o600 });
    summary.exported = values.out;
  }
  log(JSON.stringify(summary, null, 2));
}

if (/(?:^|[/\\])build-redirects\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  runBuildRedirects(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : "Redirect build failed."); process.exitCode = 1; });
}
