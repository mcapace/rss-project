#!/usr/bin/env node
/**
 * Legacy tag cleanup. The Morweb export left staff usernames ("jmccormick"), a "trending" flag and the site's own
 * name among the topic tags in metadata.tags; the AI tags (metadata.ai_tags) are untouched. Usernames are found from
 * the bylines (first initial + surname) plus a short list for multi-word surnames; lowercase topics are capitalised;
 * tags that differ only in case merge. Dry run unless --apply; each change is saved through cms_save_document, so the
 * document history keeps the old list.
 *
 *   node --import tsx scripts/wa-clean-tags.ts --brand wa
 *   node --import tsx scripts/wa-clean-tags.ts --brand wa --apply --development-target <host>
 */
import { parseArgs } from "node:util";
import type { CmsJsonObject } from "../src/lib/cms/types";
import { brandFlag, connectReader, connectTarget } from "./lib/target";

const DROP = new Set(["trending", "wadvocate", "whisky advocate"]);
// Usernames whose surname is more than one word, or whose author has no byline in this archive.
const EXTRA_HANDLES = new Set(["ddekergommeaux", "wlingsoh", "dkohlkremer", "ntovar"]);
const SPELLING: Record<string, string> = { cryptowhisky: "Crypto Whisky" };
const ACTOR = "agent:tag-cleanup-2026-11-03";

const plain = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

/** "Jonny McCormick, Julia Higgins and Aubrey Thompson" -> jmccormick, jhiggins, athompson. */
export function handlesFrom(bylines: string[]): Set<string> {
  const out = new Set<string>();
  for (const byline of bylines) for (const person of byline.split(/,|\band\b|&/)) {
    const parts = person.trim().split(/\s+/).filter(p => p && !/^(by|jr\.?|sr\.?|iii)$/i.test(p));
    if (parts.length >= 2) out.add(plain(parts[0]).slice(0, 1) + plain(parts[parts.length - 1]));
  }
  return out;
}

const titleCase = (s: string) => s.replace(/\b[a-z]/g, c => c.toUpperCase());

/** The cleaned list, or null when nothing changes. */
export function cleanTags(tags: string[], handles: Set<string>): string[] | null {
  const out: string[] = [], seen = new Set<string>();
  for (const raw of tags) {
    const tag = raw.trim(), key = tag.toLowerCase();
    if (!tag || DROP.has(key) || EXTRA_HANDLES.has(key) || (/^[a-z]+$/.test(tag) && handles.has(tag))) continue;
    const fixed = SPELLING[key] ?? (/^[a-z][a-z ]*$/.test(tag) ? titleCase(tag) : tag);
    if (seen.has(fixed.toLowerCase())) continue;
    seen.add(fixed.toLowerCase()); out.push(fixed);
  }
  return out.length === tags.length && out.every((t, i) => t === tags[i]) ? null : out;
}

export async function runCleanTags(args: string[], log: (line: string) => void = console.log) {
  const { values } = parseArgs({ args, options: { brand: { type: "string", default: "wa" }, apply: { type: "boolean", default: false }, "development-target": { type: "string" }, help: { type: "boolean", default: false } }, strict: true });
  if (values.help) { log("Usage: wa-clean-tags --brand wa [--apply --development-target HOST]"); return; }
  const brand = brandFlag(values.brand), reader = connectReader(), writer = connectTarget(values);
  const PAGE = 1000, rows: { id: string; byline: string | null; metadata: CmsJsonObject; revision: number }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await reader.from("cms_documents").select("id,byline,metadata,revision").eq("brand", brand).order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read documents: ${error.message}`);
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < PAGE) break;
  }
  const handles = handlesFrom(rows.map(r => r.byline || "").filter(Boolean));
  const changes = rows.map(r => {
    const tags = Array.isArray(r.metadata?.tags) ? (r.metadata.tags as unknown[]).filter((t): t is string => typeof t === "string") : [];
    const next = tags.length ? cleanTags(tags, handles) : null;
    return next ? { row: r, before: tags, after: next } : null;
  }).filter((c): c is NonNullable<typeof c> => !!c);
  const removed = new Map<string, number>();
  for (const c of changes) for (const t of c.before) if (!c.after.some(a => a.toLowerCase() === t.trim().toLowerCase())) removed.set(t, (removed.get(t) ?? 0) + 1);
  let saved = 0; const failures: string[] = [];
  if (writer) for (const c of changes) {
    const { error } = await writer.rpc("cms_save_document", { p_document_id: c.row.id, p_expected_revision: c.row.revision, p_patch: { metadata: { tags: c.after } }, p_actor: ACTOR });
    if (error) failures.push(`${c.row.id}: ${error.message}`); else saved += 1;
  }
  log(JSON.stringify({ mode: writer ? "development-apply" : "dry-run", brand, documents: rows.length, handles_known: handles.size, documents_changed: changes.length, saved, failures: failures.slice(0, 20),
    removed: [...removed.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200), samples: changes.slice(0, 4).map(c => ({ before: c.before, after: c.after })) }, null, 2));
}

if (/(?:^|[/\\])wa-clean-tags\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  runCleanTags(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : "Tag cleanup failed."); process.exitCode = 1; });
}
