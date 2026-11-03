import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { cmsDb } from "@/lib/cms/db";
import { visitorKey, withinLimit } from "@/lib/wa/rate-limit";
import { embedQuery, loadBottles, matchDocuments, priceLimits } from "@/lib/wa/semantic";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * The search page's answer: the reader's words matched by meaning against every
 * published rating and story, then a short answer in the magazine's voice that
 * cites only what was found. Price limits in the question ("under $80") filter
 * the bottles before the model sees them. Cached at the edge per question.
 */
const MODEL = process.env.WA_ANSWER_MODEL || "claude-sonnet-5-5";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["answer", "bottles", "stories"],
  properties: {
    answer: { type: "string", description: "Two to four sentences, at most 80 words, answering the reader from the bottles and stories given. Name the bottles you recommend. Plain prose." },
    bottles: { type: "array", items: { type: "object", additionalProperties: false, required: ["slug", "why"], properties: { slug: { type: "string" }, why: { type: "string", description: "Under 16 words, specific to the question." } } }, description: "Up to six bottles from the list, best first. Empty when the question is not about bottles or none fit." },
    stories: { type: "array", items: { type: "string" }, description: "Up to three story slugs from the list that a reader asking this should read. Empty when none fit." },
  },
};
const SYSTEM = `You answer readers' questions on whiskyadvocate.com from the magazine's own ratings and stories, which are listed for you. Use only them: never mention a bottle, score, price or fact that is not in the list. Honor every constraint in the question (price, style, region, flavor, age). Prefer bottles reviewed in the last five years, since older releases are hard to find, unless the reader asks about older or vintage bottles. If nothing listed fits, say so plainly in one sentence and return no picks. Scores and prices exactly as given. No em dashes, no exclamation marks. Return only the JSON asked for.`;

export function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (q.length < 3) return NextResponse.json({ error: "Ask a question." }, { status: 400, headers: CORS });
  try {
    const db = cmsDb();
    // Shared across every server instance: 20 uncached questions a minute per visitor (cached ones never reach here).
    if (!(await withinLimit(db, `answer:${visitorKey(request)}`, 20, 60))) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: CORS });
    const embedding = await embedQuery(q, request.signal);
    const [ratingMatches, storyMatches] = await Promise.all([matchDocuments(db, embedding, ["rating"], 80), matchDocuments(db, embedding, ["article"], 12)]);
    const bottles = await loadBottles(db, ratingMatches.map(m => m.document_id));
    const { min, max } = priceLimits(q);
    const candidates = ratingMatches.map(m => bottles.get(m.document_id)).filter((b): b is NonNullable<typeof b> => !!b)
      .filter(b => { const p = Number(b.rating.price) || 0; return (max == null || (p > 0 && p <= max)) && (min == null || p >= min); }).slice(0, 30);
    const { data: storyRows } = storyMatches.length ? await db.from("cms_documents").select("id,slug,title,excerpt,published_at").in("id", storyMatches.map(m => m.document_id)) : { data: [] };
    const storyById = new Map((storyRows ?? []).map(s => [s.id, s]));
    const stories = storyMatches.map(m => storyById.get(m.document_id)).filter((s): s is NonNullable<typeof s> => !!s).slice(0, 8);
    const bottleOut = (slug: string, why = "") => { const b = candidates.find(c => c.slug === slug); return b && { slug: b.slug, title: b.title, score: b.rating.score ?? null, price: b.rating.price ?? null, category: b.rating.category || "", line: b.flavor?.line || "", why }; };
    const storyOut = (slug: string) => { const s = stories.find(x => x.slug === slug); return s && { slug: s.slug, title: s.title, excerpt: String(s.excerpt || "").slice(0, 220) }; };
    // An hour at the edge and an hour stale at most (was a day and a week): a cached answer can cite a story or rating
    // that has since been taken down, so it must not outlive the takedown by long.
    const headers = { ...CORS, "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=3600" };
    const fallback = { answer: "", bottles: candidates.slice(0, 6).map(b => bottleOut(b.slug)), stories: stories.slice(0, 3).map(s => storyOut(s.slug)) };
    if (!process.env.ANTHROPIC_API_KEY || (!candidates.length && !stories.length)) return NextResponse.json(fallback, { headers });
    // At most WA_ANSWER_HOURLY (default 600) written answers an hour across the site; past it, readers get the matched
    // bottles and stories without the written answer, cached briefly so the answer returns once the hour turns.
    if (!(await withinLimit(db, "answer:claude", Number(process.env.WA_ANSWER_HOURLY) || 600, 3600))) return NextResponse.json(fallback, { headers: { ...CORS, "Cache-Control": "public, s-maxage=300" } });

    const list = candidates.map(b => `${b.slug} | ${b.title} | ${b.rating.score ?? "?"} pts | ${b.rating.price ? "$" + b.rating.price : "price n/a"} | ${b.rating.category || ""}${b.rating.issue ? " | " + b.rating.issue : ""}${b.flavor ? " | " + b.flavor.line + " | notes: " + b.flavor.notes.join(", ") : ""}`).join("\n");
    const storyList = stories.map(s => `${s.slug} | ${s.title} | ${String(s.excerpt || "").replace(/\s+/g, " ").slice(0, 200)}`).join("\n");
    const anthropic = new Anthropic();
    const message = await anthropic.messages.create({
      model: MODEL, max_tokens: 2000, system: SYSTEM,
      messages: [{ role: "user", content: `Reader's question: ${q}\n\nRatings (slug | name | score | price | category | issue | character | notes):\n${list || "(none fit)"}\n\nStories (slug | title | summary):\n${storyList || "(none)"}` }],
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    } as Anthropic.MessageCreateParamsNonStreaming);
    if (message.stop_reason === "max_tokens") throw new Error("the answer ran past max_tokens");
    const out = JSON.parse(message.content.map(c => (c.type === "text" ? c.text : "")).join("")) as { answer: string; bottles: { slug: string; why: string }[]; stories: string[] };
    return NextResponse.json({
      answer: String(out.answer || "").slice(0, 700),
      bottles: (out.bottles || []).map(b => bottleOut(b.slug, String(b.why || "").slice(0, 140))).filter(Boolean).slice(0, 6),
      stories: (out.stories || []).map(storyOut).filter(Boolean).slice(0, 3),
    }, { headers });
  } catch (error) {
    console.error("[wa/answer]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No answer just now." }, { status: 502, headers: CORS });
  }
}
