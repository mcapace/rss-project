#!/usr/bin/env node
/**
 * Search descriptions for every published record that has none. In order of
 * preference: the old site's own meta/og description (preserved in the source
 * snapshot), the record's excerpt or subheader, a description built from the
 * record's own fields (ratings, glossary terms, clubs), the AI summary written
 * by tag-stories, and last, a new one written by the model from the text.
 * Writes metadata.seo.description. Dry-run by default; the model is only
 * called with --apply or --ai-preview.
 *
 *   node --import tsx scripts/fill-meta-descriptions.ts --brand wa
 *   node --import tsx scripts/fill-meta-descriptions.ts --brand wa --apply --development-target <host>
 */
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import type { CmsJsonObject } from "../src/lib/cms/types";
import { brandFlag, connectReader, connectTarget } from "./lib/target";

const MODEL = process.env.WA_META_MODEL || process.env.WA_TAG_MODEL || "claude-sonnet-5-5";
const MAX = 158;
const SYSTEM = "You write search descriptions for whiskyadvocate.com, the magazine of record for whisky. Given a piece, write one description of 120 to 155 characters that tells a searcher what they will find. Use only facts in the text, name the whiskies or people it names, write plainly in the present tense, no clickbait, no em dashes, no quotation marks around the whole thing. Return only the description.";

type Row = { id: string; kind: string; title: string; excerpt: string; body_html: string; metadata: CmsJsonObject; revision: number };
const object = (value: unknown): CmsJsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as CmsJsonObject : {};
const str = (value: unknown) => typeof value === "string" ? value : "";

const ENTITIES: Record<string, string> = { amp: "&", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…", quot: '"', apos: "'", eacute: "é", egrave: "è", agrave: "à", ntilde: "ñ", uuml: "ü", ouml: "ö", auml: "ä", ccedil: "ç", deg: "°", reg: "®", trade: "™", copy: "©" };
export function plain(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<figcaption[\s\S]*?<\/figcaption>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole).replace(/\s+/g, " ").trim();
}

/** Fit a description to the search-result length, ending on a sentence or a word. */
export function fit(input: string, max = MAX): string {
  const text = plain(input).replace(/\s*[—–]\s*/g, ", ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const sentence = cut.lastIndexOf(". ");
  if (sentence >= 90) return cut.slice(0, sentence + 1);
  return cut.slice(0, cut.lastIndexOf(" ")).replace(/[\s,;:.–-]+$/, "") + "…";
}

function firstSentences(text: string, min = 60): string {
  const sentences = text.match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? [text];
  let out = "";
  for (const sentence of sentences) { out = (out + " " + sentence.trim()).trim(); if (out.length >= min) break; }
  return out;
}

/** A description from the record's own fields, when its kind has a natural one. */
export function fromFields(row: Pick<Row, "kind" | "title" | "body_html" | "metadata">): string {
  const body = plain(row.body_html ?? "");
  if (row.kind === "rating") {
    const rating = object(row.metadata.rating);
    const score = typeof rating.score === "number" ? rating.score : null;
    if (score === null) return "";
    const facts = [str(rating.category), typeof rating.price === "number" ? `$${rating.price}` : ""].filter(Boolean).join(", ");
    const lead = `${row.title.replace(/\s+/g, " ").trim()}: ${score} points${facts ? `. ${facts}` : ""}.`;
    const note = firstSentences(body, 40);
    return note ? `${lead} ${note}` : lead;
  }
  if (row.kind === "glossary_entry" && body) return `${row.title}: ${firstSentences(body)}`;
  if (row.kind === "directory_entry") {
    const directory = object(row.metadata.directory);
    const place = [str(directory.location) || str(directory.city), str(directory.state)].filter(Boolean).join(", ");
    const about = str(directory.short_desc) || firstSentences(body);
    return [`${row.title}, a whisky club${place ? ` in ${place}` : ""}.`, about].filter(Boolean).join(" ");
  }
  if (["collection_entry", "product_review", "page"].includes(row.kind) && body.length > 80) return firstSentences(body);
  return "";
}

export async function runFillMeta(args: string[], log: (line: string) => void = console.log) {
  const { values } = parseArgs({ args, options: {
    brand: { type: "string", default: "wa" }, limit: { type: "string", default: "50000" }, "ai-preview": { type: "string", default: "0" },
    apply: { type: "boolean", default: false }, "development-target": { type: "string" }, help: { type: "boolean", default: false },
  }, strict: true });
  if (values.help) { log("Usage: fill-meta-descriptions --brand wa [--ai-preview N] [--apply --development-target HOST]"); return; }
  const brand = brandFlag(values.brand);
  const limit = Math.max(1, Number(values.limit) || 50000);
  const preview = Math.max(0, Number(values["ai-preview"]) || 0);
  const reader = connectReader();
  const writer = connectTarget(values);
  const summary = { mode: writer ? "development-apply" : "dry-run", brand, scanned: 0, missing: 0, by_source: {} as Record<string, number>, by_kind: {} as Record<string, number>, saved: 0, failures: [] as string[], samples: [] as string[] };
  const anthropic = (writer || preview) && process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  if ((writer || preview) && !anthropic) throw new Error("Set ANTHROPIC_API_KEY to write descriptions the source does not have.");
  let after = "00000000-0000-0000-0000-000000000000";
  let previewed = 0;

  const write = async (row: Row, description: string, source: string) => {
    summary.by_source[source] = (summary.by_source[source] ?? 0) + 1;
    summary.by_kind[row.kind] = (summary.by_kind[row.kind] ?? 0) + 1;
    if (summary.samples.length < 40 && (summary.by_source[source] ?? 0) <= 6) summary.samples.push(`[${row.kind}/${source}] ${row.title.slice(0, 50)} => ${description}`);
    if (!writer) return;
    const seo = { title: "", no_index: false, canonical_url: null, ...object(row.metadata.seo), description };
    const { error } = await writer.rpc("cms_save_document", { p_document_id: row.id, p_expected_revision: row.revision, p_patch: { metadata: { seo } }, p_actor: "meta-descriptions" });
    if (error) summary.failures.push(`${row.id}: ${error.message}`); else summary.saved += 1;
  };
  const ai = async (row: Row) => {
    const message = await anthropic!.messages.create({
      model: MODEL, max_tokens: 200, system: SYSTEM,
      messages: [{ role: "user", content: `Title: ${row.title}\nKind: ${row.kind}\n\n${plain(row.body_html ?? "").slice(0, 5000)}` }],
      output_config: { effort: "low" },
    } as Anthropic.MessageCreateParamsNonStreaming);
    return fit(message.content.map(c => (c.type === "text" ? c.text : "")).join("").trim().replace(/^["“]|["”]$/g, ""));
  };

  while (summary.scanned < limit) {
    const { data, error } = await reader.from("cms_documents").select("id,kind,title,excerpt,body_html,metadata,revision")
      .eq("brand", brand).eq("publication_state", "published").gt("id", after).order("id").limit(100);
    if (error) throw new Error(`Could not read documents: ${error.message}`);
    const page = (data ?? []) as Row[];
    if (!page.length) break;
    after = page[page.length - 1].id;
    summary.scanned += page.length;
    const missing = page.filter(row => !str(object(row.metadata.seo).description).trim());
    summary.missing += missing.length;
    if (!missing.length) continue;
    const { data: snaps } = await reader.from("cms_source_snapshots")
      .select("document_id,md:payload->source_payload->record->>meta_description,og:payload->source_payload->record->>og_description,sub:payload->source_payload->record->custom_fields->>custom_subheader")
      .in("document_id", missing.map(row => row.id));
    const legacy = new Map<string, { md: string; og: string; sub: string }>();
    for (const snap of (snaps ?? []) as { document_id: string; md: string | null; og: string | null; sub: string | null }[]) legacy.set(snap.document_id, { md: snap.md ?? "", og: snap.og ?? "", sub: snap.sub ?? "" });

    const jobs = missing.map(row => async () => {
      const old = legacy.get(row.id);
      const candidates: [string, string][] = [
        ["legacy", old?.md || old?.og || str(object(row.metadata.legacy_seo).meta_description) || str(object(row.metadata.legacy_seo).og_description)],
        ["excerpt", row.excerpt], ["subheader", old?.sub ?? ""], ["fields", fromFields(row)], ["ai_summary", str(row.metadata.ai_summary)],
      ];
      for (const [source, value] of candidates) {
        const description = fit(value ?? "");
        if (description.length >= 50) return write(row, description, source);
      }
      if (!plain(row.body_html ?? "")) { summary.by_source.no_text = (summary.by_source.no_text ?? 0) + 1; return; }
      if (!writer && previewed >= preview) { summary.by_source["ai (pending)"] = (summary.by_source["ai (pending)"] ?? 0) + 1; return; }
      previewed += 1;
      try { await write(row, await ai(row), "ai"); } catch (failure) { summary.failures.push(`${row.id}: ${failure instanceof Error ? failure.message : "AI failed"}`); }
    });
    for (let i = 0; i < jobs.length; i += 6) await Promise.all(jobs.slice(i, i + 6).map(job => job()));
    if (summary.scanned % 2000 < 100) console.error(`scanned ${summary.scanned}, missing ${summary.missing}`);
  }
  log(JSON.stringify({ ...summary, failures: summary.failures.slice(0, 50), failure_count: summary.failures.length }, null, 2));
}

if (/(?:^|[/\\])fill-meta-descriptions\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  runFillMeta(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : "Description fill failed."); process.exitCode = 1; });
}
