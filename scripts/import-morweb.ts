#!/usr/bin/env node
/** Development-only importer. Dry-run is the default and never initializes a database client. */
import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { planMorwebImport, type MorwebImportOptions } from "../src/lib/cms/morweb";
import type { CmsBrand, CmsIngestResult } from "../src/lib/cms/types";
import { CMS_DOCUMENT_KINDS } from "../src/lib/cms/types";

const MAX_INPUT_BYTES = 1024 * 1024 * 1024;

async function readJson(path: string): Promise<unknown> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > MAX_INPUT_BYTES) throw new Error("Input must be a JSON/JSON.gz file smaller than 1 GiB.");
  const input = await readFile(path);
  const data = path.endsWith(".gz") ? gunzipSync(input, { maxOutputLength: MAX_INPUT_BYTES }) : input;
  try { return JSON.parse(data.toString("utf8")); }
  catch { throw new Error("The input is not valid JSON; its contents have not been printed."); }
}

async function assertReportIsNotInput(report: string, inputs: string[]) {
  let outputMetadata;
  try { outputMetadata = await stat(report); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  for (const input of inputs) {
    if (resolve(input) === report) throw new Error("The report path must not overwrite an input file.");
    const inputMetadata = await stat(input);
    if (outputMetadata && inputMetadata.dev === outputMetadata.dev && inputMetadata.ino === outputMetadata.ino) throw new Error("The report path resolves to an input file; choose a separate report path.");
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validateMappings(value: unknown): MorwebImportOptions {
  const mappings = record(value);
  if (!mappings) throw new Error("Mappings must be a JSON object.");
  for (const key of Object.keys(mappings)) if (!["kindOverrides", "publicationOverrides", "assetStatus"].includes(key)) throw new Error(`Unknown mappings property: ${key}`);
  const result: MorwebImportOptions = {};
  if (mappings.kindOverrides !== undefined) {
    const kinds = record(mappings.kindOverrides);
    if (!kinds || Object.entries(kinds).some(([key, kind]) => !/^(Posts|Pages):\d+$/.test(key) || !CMS_DOCUMENT_KINDS.some(allowed => allowed === kind))) throw new Error("kindOverrides require scoped source keys and a supported CMS document kind.");
    result.kindOverrides = kinds as NonNullable<MorwebImportOptions["kindOverrides"]>;
  }
  if (mappings.publicationOverrides !== undefined) {
    const overrides = record(mappings.publicationOverrides);
    if (!overrides || Object.entries(overrides).some(([key, value]) => {
      const override = record(value);
      return !/^(Posts|Pages):\d+$/.test(key) || !override || !["draft", "review", "published", "unpublished"].includes(String(override.state)) || typeof override.evidence !== "string" || !override.evidence.trim();
    })) throw new Error("publicationOverrides require a valid state and a nonempty evidence string for each scoped source key.");
    result.publicationOverrides = overrides as NonNullable<MorwebImportOptions["publicationOverrides"]>;
  }
  if (mappings.assetStatus !== undefined) {
    const assets = record(mappings.assetStatus);
    if (!assets || Object.values(assets).some(status => status !== "captured" && status !== "missing")) throw new Error("assetStatus must map source URLs to captured or missing.");
    result.assetStatus = assets as NonNullable<MorwebImportOptions["assetStatus"]>;
  }
  return result;
}

export interface MorwebCliRuntime {
  env: NodeJS.ProcessEnv;
  log: (message: string) => void;
  progress: (message: string) => void;
}

export async function runMorwebCli(args: string[], runtime: MorwebCliRuntime = { env: process.env, log: console.log, progress: console.error }) {
  const { values } = parseArgs({ args, options: {
    input: { type: "string" }, report: { type: "string" }, brand: { type: "string", default: "wa" },
    origin: { type: "string", default: "https://whiskyadvocate.com" }, mappings: { type: "string" },
    policy: { type: "string", default: "preserve" },
    apply: { type: "boolean", default: false }, "allow-held": { type: "boolean", default: false },
    "development-target": { type: "string" }, help: { type: "boolean", default: false },
  }, strict: true, allowPositionals: false });
  if (values.help) {
    runtime.log(`Usage: node --import tsx scripts/import-morweb.ts --input /private/content_archive.json.gz [--report /private/report.json]

Default: dry-run; no network calls or database writes.
Options:
  --brand wa|ws|ca|mw           Destination publication (default: wa)
  --origin https://...         Original website origin (default: https://whiskyadvocate.com)
  --mappings /private/map.json Reviewed kind/publication/asset mappings
  --policy preserve|strict    Retain valid identities by default; strict holds review-gated records
  --apply                     Import eligible records into a DEVELOPMENT database
  --development-target HOST   Must exactly match CMS_IMPORT_SUPABASE_URL's hostname
  --allow-held                In strict mode, explicitly leave review-gated records unimported

Apply requires CMS_IMPORT_SUPABASE_URL and CMS_IMPORT_SERVICE_ROLE_KEY. The CLI
does not load .env files or reuse the app's database credentials. Raw content and
source metadata are never printed; reports can still contain private route names.
Keep input and report files outside this repository.`);
    return;
  }
  if (!values.input) throw new Error("--input is required. See --help.");
  if (!["wa", "ws", "ca", "mw"].includes(values.brand!)) throw new Error("--brand must be wa, ws, ca, or mw.");
  if (values.policy !== "preserve" && values.policy !== "strict") throw new Error("--policy must be preserve or strict.");
  let sourceOrigin: URL;
  try { sourceOrigin = new URL(values.origin!); } catch { throw new Error("--origin is not a valid URL."); }
  if (!["http:", "https:"].includes(sourceOrigin.protocol) || sourceOrigin.username || sourceOrigin.password || sourceOrigin.pathname !== "/" || sourceOrigin.search) throw new Error("--origin must be an HTTP(S) origin without a path, credentials, or query.");
  const mappings = values.mappings ? validateMappings(await readJson(resolve(values.mappings))) : {};
  const plan = planMorwebImport(await readJson(resolve(values.input)), { ...mappings, brand: values.brand as CmsBrand, sourceOrigin: sourceOrigin.origin, policy: values.policy });
  const summary = {
    mode: values.apply ? "development-apply" : "dry-run",
    policy: plan.report.policy,
    source_records: plan.report.source_records,
    unique_identities: plan.report.unique_identities,
    duplicate_identical_records: plan.report.duplicate_identical_records,
    eligible_records: plan.report.eligible_records,
    eligible_by_kind: plan.report.eligible_by_kind,
    eligible_by_publication_state: plan.report.eligible_by_publication_state,
    held_records: plan.report.held_records,
    fatal_records: plan.report.fatal_records,
    review_required_records: plan.report.review_required_records,
    review_required_by_kind: plan.report.review_required_by_kind,
    finding_counts: plan.report.finding_counts,
    url_collision_count: plan.report.url_collisions.length,
    media: plan.report.media,
    target_write_performed: false,
  };
  const reportPath = values.report ? resolve(values.report) : null;
  if (reportPath) await assertReportIsNotInput(reportPath, [resolve(values.input), ...(values.mappings ? [resolve(values.mappings)] : [])]);
  if (reportPath) await writeFile(reportPath, JSON.stringify(plan.report, null, 2) + "\n", { mode: 0o600 });
  runtime.log(JSON.stringify(summary, null, 2));
  if (plan.report.fatal_records) throw new Error("The plan contains structural errors. Resolve invalid identities or conflicting source versions before applying; --allow-held cannot bypass them.");
  if (!values.apply) return;
  if (!reportPath) throw new Error("Development apply requires --report so each result and any held records are retained locally.");
  if (plan.report.held_records && !values["allow-held"]) throw new Error("The plan contains held records. Resolve them or use --allow-held to import only the explicitly reported eligible subset.");
  const target = runtime.env.CMS_IMPORT_SUPABASE_URL;
  const serviceKey = runtime.env.CMS_IMPORT_SERVICE_ROLE_KEY;
  if (!target || !serviceKey) throw new Error("Development apply requires dedicated CMS_IMPORT_SUPABASE_URL and CMS_IMPORT_SERVICE_ROLE_KEY environment variables.");
  let url: URL;
  try { url = new URL(target); } catch { throw new Error("CMS_IMPORT_SUPABASE_URL is not a valid URL."); }
  if (!values["development-target"] || values["development-target"] !== url.hostname) throw new Error("--development-target must explicitly match the dedicated development database hostname.");
  if (url.username || url.password || (url.protocol !== "https:" && !(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && url.protocol === "http:"))) throw new Error("Use HTTPS for a remote development database, or HTTP on loopback only.");
  const supabase = createClient(target, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const applied: { source_key: string; document_id: string; action: CmsIngestResult["action"]; revision: number }[] = [];
  const counts = { created: 0, unchanged: 0, candidate: 0 };
  let failure: { source_key: string; code: string } | null = null;
  let attempted = 0;
  for (const document of plan.documents) {
    attempted++;
    try {
      const { data, error } = await supabase.rpc("cms_ingest_document", { p_document: document, p_actor: "morweb-development-import" });
      if (error) { failure = { source_key: document.source_key, code: error.code || "rpc_error" }; break; }
      const result = data as CmsIngestResult;
      if (!result || !["created", "unchanged", "candidate"].includes(result.action) || !result.document_id) { failure = { source_key: document.source_key, code: "invalid_rpc_response" }; break; }
      counts[result.action]++;
      applied.push({ source_key: document.source_key, document_id: result.document_id, action: result.action, revision: result.revision });
      if (applied.length % 100 === 0) runtime.progress(`Processed ${applied.length}/${plan.documents.length} eligible records.`);
    } catch {
      failure = { source_key: document.source_key, code: "request_failed" };
      break;
    }
  }
  const didWrite = applied.length > 0 ? true : failure ? null : false;
  const outcome = { ...plan.report, target_write_performed: didWrite, target_write_attempted: attempted > 0, failed_record_completion_uncertain: Boolean(failure), target_environment: "development", result: counts, completed: !failure, applied, failure };
  if (reportPath) await writeFile(reportPath, JSON.stringify(outcome, null, 2) + "\n", { mode: 0o600 });
  runtime.log(JSON.stringify({ completed: !failure, result: counts, processed_records: applied.length, target_write_performed: didWrite, target_write_attempted: attempted > 0, failed_record_completion_uncertain: Boolean(failure), failure }, null, 2));
  if (failure) throw new Error("Import stopped at the reported record. Completed writes are individually atomic; rerunning the unchanged input is safe.");
}

// Keep the runner importable for offline tests. Only the documented entrypoint executes it.
if (/(?:^|[/\\])import-morweb\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  runMorwebCli(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : "Import failed.");
    process.exitCode = 1;
  });
}
