#!/usr/bin/env node
/**
 * The SEO and GEO pass: gives every published record the search and answer-engine
 * fields the site renders (src/lib/wa/seo.ts), as the content is rebuilt.
 *
 * Written into metadata.seo, next to the existing no_index and canonical_url:
 *   title         search title, 25 to 60 characters, the main subject first
 *   description   120 to 155 characters, what a searcher will find, facts from the piece
 *   og_title, og_description   social copy (up to 90 and 200 characters)
 *   focus_keyword, keywords    the phrase the piece should rank for, and 5 to 10 more
 *   summary       answer-first summary for AI answer engines (GEO), up to 320 characters
 *   key_facts     3 to 5 short facts (names, numbers, places) an answer engine can cite
 *   entities      the people, brands, distilleries, places and products it is about
 *   pass          { version, model, at }; previous { title, description } when replaced
 *
 * An editor's own title and description are kept when they already meet the rules
 * (lengths, no markup); metadata.seo.locked = true leaves a record untouched.
 * Stories, pages and directory entries are written by Claude from the text. Ratings are
 * built from their own fields (name, score, category, price, tasting note) with no model
 * call. Glossary entries and 90+ Club entries redirect elsewhere and are skipped.
 *
 * Dry-run by default (counts what is left); --preview N writes nothing and prints N
 * results; --apply saves through cms_save_document, a revision per record.
 *
 *   node --import tsx scripts/wa-seo-pass.ts --brand wa
 *   node --import tsx scripts/wa-seo-pass.ts --brand wa --kind article --preview 8
 *   node --import tsx scripts/wa-seo-pass.ts --brand wa --kind article --limit 400 --apply --development-target <host>
 *
 * Needs ANTHROPIC_API_KEY to preview or apply stories. WA_SEO_MODEL picks the model
 * (default claude-opus-5-5).
 */
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import type { CmsJsonObject } from "../src/lib/cms/types";
import { plain } from "./fill-meta-descriptions";
import { brandFlag, connectReader, connectTarget } from "./lib/target";

export const VERSION = "2026-11-01";
const MODEL = process.env.WA_SEO_MODEL || "claude-opus-5-5";
const STORY_KINDS = ["article", "legacy_record", "collection_entry", "directory_entry", "page"];
const KINDS = [...STORY_KINDS, "rating"];
const ENTITY_TYPES = ["person", "brand", "distillery", "company", "place", "product", "event"] as const;

const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["title", "description", "og_title", "og_description", "focus_keyword", "keywords", "summary", "key_facts", "entities"],
  properties: {
    title: { type: "string" }, description: { type: "string" }, og_title: { type: "string" }, og_description: { type: "string" },
    focus_keyword: { type: "string" }, keywords: { type: "array", items: { type: "string" } }, summary: { type: "string" },
    key_facts: { type: "array", items: { type: "string" } },
    entities: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "type"], properties: { name: { type: "string" }, type: { type: "string", enum: [...ENTITY_TYPES] } } } },
  },
} as const;

const SYSTEM = `You write the search and answer-engine fields for whiskyadvocate.com, the magazine of record for whisky. Given one piece, return JSON:
- title: the search title, 25 to 60 characters; count them, never more than 60. Put the main subject first (the whisky, distillery, person, place or topic people search for), then what the piece offers (review, guide, recipe, news, interview). Keep the piece's meaning; no clickbait, no year unless it matters, no site name.
- description: 120 to 155 characters (never more than 155) telling a searcher exactly what they will find, using only facts in the piece and naming the whiskies, people or places it names. Present tense, plain words, one or two sentences.
- og_title: a social headline up to 90 characters, the most interesting true thing in the piece.
- og_description: up to 200 characters for social sharing.
- focus_keyword: the one lowercase search phrase this piece should rank for.
- keywords: 5 to 10 lowercase phrases readers search for, most specific first, no repeats of the focus keyword.
- summary: an answer-first summary for AI answer engines, 2 or 3 sentences and at most 320 characters: what happened or what the piece concludes, with the key names and numbers, so it can be quoted on its own.
- key_facts: 3 to 5 short factual statements (at most 120 characters each) with names, numbers, dates or places from the piece that an answer engine could cite.
- entities: up to 10 people, brands, distilleries, companies, places, products or events the piece is about, most central first, with their type.
Facts must come from the piece. If the piece is thin, say less rather than invent. No em dashes, no quotation marks around values, no marketing language.`;

type Row = { id: string; kind: string; slug: string | null; title: string; byline: string | null; excerpt: string | null; body_html: string | null; metadata: CmsJsonObject; revision: number };
const obj = (value: unknown): CmsJsonObject => (value && typeof value === "object" && !Array.isArray(value) ? (value as CmsJsonObject) : {});
const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const strs = (value: unknown) => (Array.isArray(value) ? value.map(str).filter(Boolean) : []);

/** Cut to `max` on a word without a trailing separator. */
export function clip(input: string, max: number): string {
  const text = plain(input).replace(/\s*[—–]\s*/g, ", ").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const end = cut.lastIndexOf(" ");
  return (end > max * 0.6 ? cut.slice(0, end) : cut.slice(0, max)).replace(/[\s,;:–-]+$/, "");
}

/** A title over `max` cut at its last clause (": ", " | ", " - ", ", "), never mid-phrase; a word cut only as a last resort. */
export function fitTitle(input: string, max = 60, min = 25): string {
  const text = clip(input, 400);
  if (text.length <= max) return text;
  const head = text.slice(0, max + 1);
  for (const sep of [": ", " | ", " - ", ", ", " & ", " and "]) {
    const at = head.lastIndexOf(sep);
    if (at >= min) return text.slice(0, at).replace(/[\s,;:&-]+$/, "");
  }
  return clip(text, max).replace(/\s+(and|or|with|of|the|a|an|for|to|in|on|at|new)$/i, "");
}

/** A description over `max` ends on its last full sentence, else its last clause, with no ellipsis. */
export function fitDescription(input: string, max = 155, min = 100): string {
  const text = clip(input, 1000);
  if (text.length <= max) return text;
  const head = text.slice(0, max + 1);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (sentence >= min) return head.slice(0, sentence + 1);
  const clause = Math.max(head.lastIndexOf(", "), head.lastIndexOf("; "));
  if (clause >= min) return `${head.slice(0, clause)}.`;
  // Before a word cut, end where a new phrase starts ("... and the new Fort Nelson distillery"), so no name is split.
  const joins = [" and ", " with ", " while ", " as ", " after ", " before ", " including ", " plus ", " where ", " which "].map(join => head.lastIndexOf(join));
  const join = Math.max(...joins);
  if (join >= min - 10) return `${head.slice(0, join).replace(/[\s,;:]+$/, "")}.`;
  if (clause >= min - 20) return `${head.slice(0, clause)}.`;
  return `${clip(text, max - 1).replace(/\s+(and|or|with|of|the|a|an|for|to|in|on|at)$/i, "")}.`;
}

/** A search title an editor wrote that already meets the rules. */
export function goodTitle(value: string): boolean { return value.length >= 25 && value.length <= 60 && !/[<>]|&[a-z]+;/i.test(value); }
/** A description that already meets the rules. */
export function goodDescription(value: string): boolean { return value.length >= 120 && value.length <= 158 && !/[<>]|&[a-z]+;/i.test(value) && !/(…|\.\.\.)\s*$/.test(value); }

/** A rating's fields from its own data: no model call. */
export function ratingSeo(row: Pick<Row, "title" | "body_html" | "excerpt" | "metadata">): CmsJsonObject {
  const meta = obj(row.metadata);
  const rating = obj(meta.rating);
  const seo = obj(meta.seo);
  const name = plain(row.title).replace(/\s+/g, " ").trim();
  const short = name.replace(/,\s*\d+(?:\.\d+)?%\s*$/, "").trim();
  const score = Number(rating.score) > 0 ? Number(rating.score) : null;
  const price = Number(rating.price) > 0 ? Number(rating.price) : null;
  const category = str(rating.category);
  const brand = str(rating.brand) || str(rating.producer);
  const abv = /(\d+(?:\.\d+)?)%\s*$/.exec(name)?.[1];
  const note = plain(row.body_html || row.excerpt || "");
  const tail = score ? `: ${score} Points` : " Review";
  const title = short.length + tail.length <= 60 ? `${short}${tail}` : `${clip(short, 60 - tail.length)}${tail}`;
  const lead = [score ? `${short}: ${score} points` : short, [category, price ? `$${price}` : ""].filter(Boolean).join(", ")].filter(Boolean).join(". ");
  const built = fitDescription(`${lead}. ${note}`);
  const existing = str(seo.description);
  const description = goodDescription(existing) ? existing : built;
  const firstSentence = note.match(/^[^.!?]+[.!?]/)?.[0] ?? "";
  return {
    title, description,
    og_title: clip(score ? `${short} scores ${score} points` : short, 90),
    og_description: clip([lead, note].filter(Boolean).join(". "), 200),
    focus_keyword: `${short.toLowerCase()} review`,
    keywords: [...new Set([`${short.toLowerCase()} rating`, category ? `${category.toLowerCase()} review` : "", brand ? brand.toLowerCase() : "", "whisky advocate rating"].filter(Boolean))],
    summary: clip(`Whisky Advocate rated ${short} ${score ? `${score} points` : ""}${category ? ` (${category}${price ? `, $${price}` : ""})` : price ? ` ($${price})` : ""}. ${firstSentence}`.replace(/\s+\./g, ".").replace(/\s+/g, " "), 320),
    key_facts: [score ? `Score: ${score} points out of 100` : "", category ? `Category: ${category}` : "", price ? `Price: $${price}` : "", abv ? `Bottling strength: ${abv}% ABV` : "", str(rating.reviewer) ? `Tasted by ${str(rating.reviewer)}` : ""].filter(Boolean),
    entities: [brand ? { name: brand, type: "brand" } : null, { name: short, type: "product" }].filter(Boolean) as CmsJsonObject[],
  };
}

/** Tidy a model answer to the rules, keeping an editor's title and description when they already meet them. */
export function tidyStory(raw: Record<string, unknown>, existing: CmsJsonObject, docTitle: string): CmsJsonObject {
  const keepTitle = goodTitle(str(existing.title));
  const keepDescription = goodDescription(str(existing.description));
  const title = keepTitle ? str(existing.title) : fitTitle(str(raw.title) || docTitle);
  const description = keepDescription ? str(existing.description) : fitDescription(str(raw.description));
  const focus = clip(str(raw.focus_keyword).toLowerCase(), 60);
  return {
    title, description,
    og_title: fitTitle(str(raw.og_title) || docTitle, 95, 40), og_description: fitDescription(str(raw.og_description) || description, 300, 150),
    focus_keyword: focus,
    keywords: [...new Set(strs(raw.keywords).map(k => clip(k.toLowerCase(), 50)).filter(k => k && k !== focus))].slice(0, 10),
    summary: clip(str(raw.summary), 320),
    key_facts: strs(raw.key_facts).map(f => clip(f, 120)).slice(0, 5),
    entities: (Array.isArray(raw.entities) ? raw.entities : []).map(obj).map(e => ({ name: clip(str(e.name), 80), type: (ENTITY_TYPES as readonly string[]).includes(str(e.type)) ? str(e.type) : "brand" })).filter(e => e.name).slice(0, 10),
  };
}

export async function runSeoPass(args: string[], log: (line: string) => void = console.log) {
  const { values } = parseArgs({ args, options: {
    brand: { type: "string", default: "wa" }, kind: { type: "string" }, limit: { type: "string", default: "300" }, concurrency: { type: "string", default: "4" },
    redo: { type: "boolean", default: false }, fix: { type: "boolean", default: false }, preview: { type: "string" },
    apply: { type: "boolean", default: false }, "development-target": { type: "string" }, help: { type: "boolean", default: false },
  }, strict: true });
  if (values.help) { log("Usage: wa-seo-pass --brand wa [--kind article|rating|...] [--limit N] [--concurrency N] [--redo | --fix] [--preview N] [--apply --development-target HOST]"); return; }
  const brand = brandFlag(values.brand);
  if (values.kind && !KINDS.includes(values.kind)) throw new Error(`--kind must be one of ${KINDS.join(", ")}.`);
  const kinds = values.kind ? [values.kind] : KINDS;
  const previewCount = values.preview ? Math.min(30, Math.max(1, Number(values.preview) || 8)) : 0;
  const limit = previewCount || Math.min(5000, Math.max(1, Number(values.limit) || 300));
  const concurrency = Math.min(8, Math.max(1, Number(values.concurrency) || 4));
  const reader = connectReader();
  const writer = connectTarget(values);
  const calls = Boolean(writer || previewCount);
  const needsModel = kinds.some(kind => STORY_KINDS.includes(kind));
  if (calls && needsModel && !process.env.ANTHROPIC_API_KEY) throw new Error("Stories need ANTHROPIC_API_KEY.");

  // Records this version has not covered yet, newest first so the live site's stories come first.
  const rows: Row[] = [];
  let left = 0;
  // --fix takes the records whose description ends in an ellipsis, whatever pass wrote them; otherwise the records this version has not covered.
  const select = "id,kind,slug,title,byline,excerpt,body_html,metadata,revision";
  for (const kind of kinds) {
    for (const ending of values.fix ? ["%…", "%..."] : [null]) {
      const base = () => reader.from("cms_documents").select(select, { count: "exact" }).eq("brand", brand).eq("publication_state", "published").eq("kind", kind).not("slug", "is", null);
      const { data, error, count } = await (ending
        ? base().like("metadata->seo->>description", ending)
        : base().or(values.redo ? "id.not.is.null" : `metadata->seo->pass->>version.is.null,metadata->seo->pass->>version.neq.${VERSION}`))
        .order("published_at", { ascending: false, nullsFirst: false }).limit(Math.max(0, limit - rows.length));
      if (error) throw new Error(`Could not read ${kind} records: ${error.message}`);
      left += count ?? 0;
      // A record an editor locked keeps its fields.
      rows.push(...((data ?? []) as Row[]).filter(row => obj(obj(row.metadata).seo).locked !== true && !rows.some(seen => seen.id === row.id)));
      if (rows.length >= limit) break;
    }
    if (rows.length >= limit) break;
  }
  const summary = { mode: writer ? "development-apply" : previewCount ? "preview" : "dry-run", brand, kinds, model: needsModel ? MODEL : null, records_left: left, documents: rows.length, saved: 0, kept_title: 0, kept_description: 0, failed: 0, failures: [] as string[], samples: [] as unknown[] };
  if (!calls || !rows.length) { log(JSON.stringify(summary, null, 2)); return summary; }

  const anthropic = needsModel ? new Anthropic() : null;
  async function one(row: Row) {
    try {
      const meta = obj(row.metadata);
      const existing = obj(meta.seo);
      let fields: CmsJsonObject;
      let model: string | null = null;
      if (row.kind === "rating") fields = ratingSeo(row);
      else {
        const text = plain(row.body_html || "");
        const words = text.split(" ");
        const piece = [
          `Title: ${plain(row.title)}`, row.byline ? `Byline: ${row.byline}` : "",
          `Kind: ${row.kind}`, strs(meta.categories).length ? `Sections: ${strs(meta.categories).join(", ")}` : "",
          (strs(meta.ai_tags).length ? strs(meta.ai_tags) : strs(meta.tags)).length ? `Tags: ${(strs(meta.ai_tags).length ? strs(meta.ai_tags) : strs(meta.tags)).slice(0, 12).join(", ")}` : "",
          str(obj(meta.legacy_dates).published_date) ? `Published: ${str(obj(meta.legacy_dates).published_date).slice(0, 10)}` : "",
          row.excerpt ? `Dek: ${plain(row.excerpt)}` : "",
          str(existing.title) ? `Current search title: ${str(existing.title)}` : "", str(existing.description) ? `Current description: ${str(existing.description)}` : "",
          `Text${words.length > 1800 ? " (first 1,800 words)" : ""}:\n${words.slice(0, 1800).join(" ") || "(no body text)"}`,
        ].filter(Boolean).join("\n");
        const message = await anthropic!.beta.messages.create({
          model: MODEL, max_tokens: 6000,
          betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
          output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
          system: SYSTEM,
          messages: [{ role: "user", content: piece }],
        });
        if (message.stop_reason === "refusal") throw new Error(`declined (${message.stop_details?.category ?? "no category"})`);
        if (message.stop_reason === "max_tokens") throw new Error("answer cut off");
        fields = tidyStory(JSON.parse(message.content.map(block => (block.type === "text" ? block.text : "")).join("")) as Record<string, unknown>, existing, plain(row.title));
        model = message.model;
      }
      if (fields.title === str(existing.title)) summary.kept_title++;
      if (fields.description === str(existing.description)) summary.kept_description++;
      const previous = fields.title !== str(existing.title) || fields.description !== str(existing.description) ? { title: str(existing.title), description: str(existing.description) } : existing.previous;
      const seo: CmsJsonObject = { ...existing, ...fields, ...(previous ? { previous } : {}), pass: { version: VERSION, model: model ?? "fields", at: new Date().toISOString() } };
      if (summary.samples.length < (previewCount || 3)) summary.samples.push({ slug: row.slug, kind: row.kind, ...fields });
      if (!writer) return;
      const { error } = await writer.rpc("cms_save_document", { p_document_id: row.id, p_expected_revision: row.revision, p_patch: { metadata: { seo } }, p_actor: "agent:seo-pass" });
      if (error) throw new Error(error.message);
      summary.saved++;
    } catch (failure) {
      summary.failed++;
      if (summary.failures.length < 40) summary.failures.push(`${row.slug ?? row.id}: ${failure instanceof Error ? failure.message : String(failure)}`.slice(0, 300));
    }
  }
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => { while (next < rows.length) await one(rows[next++]); }));
  log(JSON.stringify(summary, null, 2));
  return summary;
}

if (/(?:^|[/\\])wa-seo-pass\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  runSeoPass(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
}
