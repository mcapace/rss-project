#!/usr/bin/env node
/**
 * A structured flavor profile for every published Whisky Advocate rating, read from its tasting note by a model
 * and stored on the rating as metadata.flavor: twelve flavor axes scored 0-10, body and finish 1-5, the note's
 * main flavors as plain terms, and one line in the house voice. The flavor map, "bottles like this" and the
 * palate profile all read it. Resumable: a rating that already has this version's profile is skipped.
 *
 *   node --import tsx scripts/wa-flavor-profiles.ts [--limit 20]                 (dry run: prints profiles)
 *   node --import tsx scripts/wa-flavor-profiles.ts --apply --development-target <host> [--concurrency 8]
 *
 * Needs ANTHROPIC_API_KEY. WA_FLAVOR_MODEL picks the model.
 */
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { connectReader, connectTarget } from "./lib/target";

export const FLAVOR_VERSION = 1;
export const AXES = ["smoke", "maritime", "sweet", "fresh_fruit", "dried_fruit", "tropical", "floral", "spice", "oak", "grain", "nutty", "herbal"] as const;
export type Flavor = { v: number; axes: Record<(typeof AXES)[number], number>; body: number; finish: number; notes: string[]; line: string };

const MODEL = process.env.WA_FLAVOR_MODEL || "claude-sonnet-5-5";
const SYSTEM = `You read Whisky Advocate tasting notes and score what the note itself says, nothing else. You never add flavors the note does not mention or clearly imply.
Axes, 0 (absent) to 10 (dominant):
- smoke: peat smoke, wood smoke, char, campfire, bonfire, ash, smoked meat
- maritime: brine, sea spray, salt, iodine, seaweed, medicinal, TCP, tar, rope
- sweet: vanilla, caramel, toffee, honey, butterscotch, maple, sugar, candy, custard
- fresh_fruit: apple, pear, citrus, lemon, orange, berries, stone fruit, grape
- dried_fruit: raisin, fig, date, prune, sherry, dark fruit, fruitcake, jam
- tropical: pineapple, mango, banana, coconut, passion fruit
- floral: flowers, heather, rose, perfume, blossom, lavender
- spice: pepper, cinnamon, clove, nutmeg, ginger, rye spice, baking spice, anise
- oak: wood, oak, cedar, tannin, leather, tobacco, cigar box, polish, char-free wood notes
- grain: malt, cereal, barley, corn, bread, biscuit, porridge, grist, rye bread
- nutty: nuts, almond, walnut, marzipan, chocolate, cocoa, coffee, mocha
- herbal: mint, eucalyptus, grass, hay, herbs, tea, pine, vegetal
body: 1 light to 5 full and oily, from texture words (silky, oily, thin, viscous) and overall weight; 3 when the note does not say.
finish: 1 short to 5 very long; 3 when the note does not say.
notes: up to 8 of the note's own flavors as short lowercase terms ("peat smoke", "lemon", "butterscotch"), most prominent first.
line: one sentence of at most 14 words describing the whisky's character for a shopper, plain and specific, no score, no hype.`;
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["axes", "body", "finish", "notes", "line"],
  properties: {
    axes: { type: "object", additionalProperties: false, required: [...AXES], properties: Object.fromEntries(AXES.map(a => [a, { type: "integer" }])) },
    body: { type: "integer" }, finish: { type: "integer" },
    notes: { type: "array", items: { type: "string" } }, line: { type: "string" },
  },
};

const clamp = (n: unknown, lo: number, hi: number, fallback: number) => { const v = Math.round(Number(n)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback; };
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&rsquo;/g, "'").replace(/\s+/g, " ").trim();

export function normalizeFlavor(raw: { axes?: Record<string, unknown>; body?: unknown; finish?: unknown; notes?: unknown; line?: unknown }): Flavor {
  const axes = Object.fromEntries(AXES.map(a => [a, clamp(raw.axes?.[a], 0, 10, 0)])) as Flavor["axes"];
  const notes = (Array.isArray(raw.notes) ? raw.notes : []).map(n => String(n).toLowerCase().trim()).filter(Boolean).slice(0, 8);
  return { v: FLAVOR_VERSION, axes, body: clamp(raw.body, 1, 5, 3), finish: clamp(raw.finish, 1, 5, 3), notes, line: String(raw.line || "").trim().slice(0, 140) };
}

async function profile(anthropic: Anthropic, row: { title: string; body_html: string; rating: { category?: string } | null }): Promise<Flavor> {
  const message = await anthropic.messages.create({
    model: MODEL, max_tokens: 1500, system: SYSTEM,
    messages: [{ role: "user", content: `${row.title} (${row.rating?.category || "spirit"})\nTasting note: ${plain(row.body_html)}` }],
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
  } as Anthropic.MessageCreateParamsNonStreaming);
  if (message.stop_reason === "max_tokens") throw new Error("answer ran past max_tokens");
  return normalizeFlavor(JSON.parse(message.content.map(c => (c.type === "text" ? c.text : "")).join("")));
}

async function main() {
  const { values } = parseArgs({ options: {
    apply: { type: "boolean", default: false }, "development-target": { type: "string" },
    limit: { type: "string", default: "20" }, concurrency: { type: "string", default: "8" },
  }, strict: true });
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY.");
  const reader = connectReader();
  const writer = connectTarget(values);
  const limit = Math.max(1, Number(values.limit) || 20);
  const anthropic = new Anthropic({ maxRetries: 4 });

  type Row = { id: string; slug: string; title: string; body_html: string; revision: number; rating: { category?: string } | null; flavor: { v?: number } | null };
  const todo: Row[] = [];
  let after = "00000000-0000-0000-0000-000000000000";
  while (todo.length < limit) {
    const { data, error } = await reader.from("cms_documents").select("id,slug,title,body_html,revision,rating:metadata->rating,flavor:metadata->flavor")
      .eq("brand", "wa").eq("kind", "rating").eq("publication_state", "published").gt("id", after).order("id").limit(500);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Row[];
    if (!rows.length) break;
    after = rows[rows.length - 1].id;
    todo.push(...rows.filter(r => r.flavor?.v !== FLAVOR_VERSION && plain(r.body_html || "").length > 20));
  }
  const queue = todo.slice(0, limit);
  const summary = { mode: writer ? "apply" : "dry-run", model: MODEL, queued: queue.length, saved: 0, failures: [] as string[] };
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const row = queue[next++];
      try {
        const flavor = await profile(anthropic, row);
        if (!writer) { console.log(JSON.stringify({ slug: row.slug, ...flavor })); continue; }
        let revision = row.revision;
        for (let attempt = 0; attempt < 3; attempt++) {
          const { error } = await writer.rpc("cms_save_document", { p_document_id: row.id, p_expected_revision: revision, p_patch: { metadata: { flavor } }, p_actor: "agent:flavor-profiles" });
          if (!error) { summary.saved++; break; }
          if (!/revision/i.test(error.message) || attempt === 2) throw new Error(error.message);
          const { data } = await reader.from("cms_documents").select("revision").eq("id", row.id).single();
          revision = (data as { revision: number }).revision;
        }
        if (summary.saved % 250 === 0) console.error(`saved ${summary.saved}/${queue.length}`);
      } catch (error) {
        summary.failures.push(`${row.slug}: ${error instanceof Error ? error.message : error}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(32, Math.max(1, Number(values.concurrency) || 8)) }, worker));
  console.log(JSON.stringify({ ...summary, failures: summary.failures.slice(0, 20), failure_count: summary.failures.length }, null, 2));
}

if (/(?:^|[/\\])wa-flavor-profiles\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
}
