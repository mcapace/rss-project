#!/usr/bin/env node
/**
 * AI tags for every published article: a consistent tag set (style, region,
 * producer, bottle, theme), a one-line summary and the phrases a reader would
 * search, written into metadata.ai_tags / ai_summary / ai_search so the public
 * site's tag pages, search and "more like this" have something solid to match on.
 * Needs ANTHROPIC_API_KEY.
 *
 *   node --import tsx scripts/tag-stories.ts --brand wa [--limit 200] [--force]
 *   node --import tsx scripts/tag-stories.ts --brand wa --limit 200 --apply --development-target <host>
 */
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import type { CmsJsonObject } from "../src/lib/cms/types";
import { brandFlag, connectReader, connectTarget } from "./lib/target";

const MODEL = process.env.WA_TAG_MODEL || "claude-sonnet-5-5";
const VERSION = 1;
const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    tags: { type: "array", items: { type: "string" }, description: "6 to 10 tags in Title Case, each one to three words, drawn from: the whisky style(s) the piece is about (Bourbon, Rye, Single Malt Scotch, Blended Scotch, Irish Whiskey, Japanese Whisky, Canadian Whisky, American Single Malt, Tequila, Mezcal, Rum, Cognac), the region (Kentucky, Islay, Speyside, Highlands, Tennessee, Hokkaido), every producer or brand named, every specific bottle named exactly as the piece names it, and the theme (New Release, Review, Gift Guide, Value, Collecting, Auction, Cocktails, Recipe, Distillery Visit, Travel, Bars, History, Interview, How To, Food Pairing, WhiskyFest, Industry). Use the same spelling every time; never invent a producer." },
    summary: { type: "string", description: "One sentence, under 30 words, saying what the piece is about and who it is for. No em dashes." },
    search_phrases: { type: "array", items: { type: "string" }, description: "4 to 6 plain phrases a reader might type to find this piece (for example 'best bourbon under 50', 'how to taste whisky', 'Ardbeg 10 review')." },
  },
  required: ["tags", "summary", "search_phrases"],
};
const SYSTEM = "You index articles for whiskyadvocate.com, the magazine of record for whisky. You read an article and return the tags, the one-line summary and the search phrases its readers would use. Be exact about names: a producer or bottle only if the article names it. Return only the JSON asked for.";

function text(html: string) { return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "'").replace(/\s+/g, " ").trim(); }

export async function runTags(args: string[], log: (line: string) => void = console.log) {
  const { values } = parseArgs({ args, options: {
    brand: { type: "string", default: "wa" }, limit: { type: "string", default: "200" }, force: { type: "boolean", default: false },
    apply: { type: "boolean", default: false }, "development-target": { type: "string" }, help: { type: "boolean", default: false },
  }, strict: true });
  if (values.help) { log("Usage: tag-stories --brand wa [--limit N] [--force] [--apply --development-target HOST]"); return; }
  const brand = brandFlag(values.brand);
  const limit = Math.min(500, Math.max(1, Number(values.limit) || 200));
  const reader = connectReader();
  const writer = connectTarget(values);
  let query = reader.from("cms_documents").select("id,title,byline,excerpt,body_html,metadata,revision").eq("brand", brand).eq("kind", "article").eq("publication_state", "published").order("updated_at", { ascending: false }).limit(limit);
  if (!values.force) query = query.or(`metadata->ai_tags.is.null,metadata->>ai_tags_version.neq.${VERSION}`);
  const { data, error } = await query;
  if (error) throw new Error(`Could not read articles: ${error.message}`);
  const rows = (data ?? []) as { id: string; title: string; byline: string; excerpt: string; body_html: string; metadata: CmsJsonObject; revision: number }[];
  const summary = { mode: writer ? "development-apply" : "dry-run", brand, documents: rows.length, tagged: 0, failures: [] as string[], sample: [] as unknown[] };
  if (!rows.length) { log(JSON.stringify(summary, null, 2)); return summary; }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY to tag articles.");
  const anthropic = new Anthropic();
  const legacy = (m: CmsJsonObject) => Array.isArray(m.tags) ? (m.tags as unknown[]).filter((t): t is string => typeof t === "string") : [];
  async function tagOne(row: typeof rows[number]) {
    const body = text(row.body_html).slice(0, 6000);
    const message = await anthropic.messages.create({
      model: MODEL, max_tokens: 500, system: SYSTEM,
      messages: [{ role: "user", content: `Title: ${row.title}\nByline: ${row.byline}\nExisting tags: ${legacy(row.metadata).join(", ") || "none"}\n\n${body}` }],
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
    } as Anthropic.MessageCreateParamsNonStreaming);
    const out = JSON.parse(message.content.map(c => (c.type === "text" ? c.text : "")).join("")) as { tags: string[]; summary: string; search_phrases: string[] };
    const tags = [...new Set(out.tags.map(t => t.trim()).filter(t => t && t.length <= 40))].slice(0, 10);
    return { tags, summary: out.summary.trim().slice(0, 240), search: [...new Set(out.search_phrases.map(p => p.trim().toLowerCase()).filter(Boolean))].slice(0, 6) };
  }
  let active = 0, index = 0;
  await new Promise<void>(resolve => {
    const next = () => {
      if (index >= rows.length && active === 0) return resolve();
      while (active < 6 && index < rows.length) {
        const row = rows[index++]; active += 1;
        tagOne(row).then(async result => {
          if (summary.sample.length < 3) summary.sample.push({ title: row.title, ...result });
          if (writer) {
            const { error: saveError } = await writer.rpc("cms_save_document", { p_document_id: row.id, p_expected_revision: row.revision, p_patch: { metadata: { ai_tags: result.tags, ai_summary: result.summary, ai_search: result.search, ai_tags_version: VERSION, ai_tagged_at: new Date().toISOString() } }, p_actor: "tag-stories" });
            if (saveError) summary.failures.push(`${row.id}: ${saveError.message}`); else summary.tagged += 1;
          } else summary.tagged += 1;
        }).catch(failure => { summary.failures.push(`${row.id}: ${failure instanceof Error ? failure.message : "failed"}`); }).finally(() => { active -= 1; next(); });
      }
    };
    next();
  });
  log(JSON.stringify(summary, null, 2));
  return summary;
}

const invokedDirectly = process.argv[1] && /tag-stories\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) runTags(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
