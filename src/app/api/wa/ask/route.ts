import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { cmsDb } from "@/lib/cms/db";
import { embeddingsConfigured } from "@/lib/editorial/server/embeddings";
import { embedQuery, loadBottles, matchDocuments, priceLimits, recentFirst, reviewYear } from "@/lib/wa/semantic";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Ask Whisky Advocate: the public site's chat. The browser sends the
 * conversation so far and the bottles its own search found for the latest
 * question (name, score, price, category, producer, a line of the note), and
 * Claude answers in the magazine's voice from those bottles only, naming the
 * ones it recommends so the page can show their cards. Nothing is stored.
 *
 * Rate limited per address. ANTHROPIC_API_KEY on the project; WA_ASK_MODEL
 * overrides the model.
 */
const MODEL = process.env.WA_ASK_MODEL || "claude-sonnet-5-5";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const bucket = new Map<string, { count: number; at: number }>();

function limited(ip: string) {
  const now = Date.now(); const hit = bucket.get(ip);
  if (!hit || now - hit.at > 60_000) { bucket.set(ip, { count: 1, at: now }); return false; }
  hit.count += 1; return hit.count > 12;
}

type Turn = { role: "user" | "assistant"; text: string };
type Bottle = { slug: string; name: string; score: number; price: number | null; category: string; producer: string; year?: number | null; note?: string; how?: string };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string", description: "The reply, under 110 words, plain prose, no markdown, no bullet lists. Name bottles exactly as given." },
    picks: { type: "array", items: { type: "string" }, description: "Slugs of the bottles the answer recommends, best first, at most four, only from the list provided." },
    followups: { type: "array", items: { type: "string" }, description: "Two or three short questions the reader might ask next, under nine words each." },
    actions: {
      type: "array", description: "At most two things the page can do next, only when the reader asks or clearly would want them. compare: two or three slugs the reader is weighing against each other. flight: three or four slugs in tasting order, lightest and least smoky first, when the reader asks for a flight, a tasting, a lineup or a progression; title names it. buy: one slug, when the reader asks where to buy or get it. save: one slug, when the reader wants to remember, save or keep a bottle. Slugs only from the list provided. Usually empty.",
      items: { type: "object", additionalProperties: false, required: ["type", "slugs", "title"], properties: { type: { type: "string", enum: ["compare", "flight", "buy", "save"] }, slugs: { type: "array", items: { type: "string" } }, title: { type: "string", description: "A short name for a flight (under six words); empty for the other types." } } },
    },
  },
  required: ["answer", "picks", "followups", "actions"],
};

const SYSTEM = `You are Ask Whisky Advocate, the assistant on whiskyadvocate.com, the magazine of record for whisky. You speak like a knowledgeable, warm editor: direct, specific, never gushing, no exclamation marks, no emoji, no em dashes. American English, "whisky" for Scotch and Japanese, "whiskey" for American and Irish.

You answer from the bottles the page gives you, which come from Whisky Advocate's own blind-tasted ratings (100-point scale: 95 to 100 classic, 90 to 94 outstanding, 85 to 89 very good). Recommend by fit first, then score, then price, and say why in a sentence each. Lean to bottles reviewed in the last five years (the year is given), since those are the ones a reader can still buy; recommend an older review only when nothing recent fits, or when the reader asks about older, vintage or discontinued bottles, and then say it may be hard to find. Lean the same way toward regular releases over rare ones (decades-old age statements, single casks, limited editions, bottles over $500) unless the reader asks for something rare, special or a splurge. Quote scores and prices exactly as given. Never invent a bottle, a score, a price or a tasting note. If the list does not fit the question, say so plainly and suggest how to narrow or widen it. Questions outside whisky (and the cocktails, bars and travel around it) get one polite sentence pointing back to whisky. Keep the whole reply under 110 words. Return only the JSON asked for.`;

/** Ratings that read closest to the question by meaning, within any price limit it names; the browser's own search finds names and styles, this finds the rest. */
async function closeInMeaning(question: string, have: Set<string>, signal: AbortSignal) {
  if (!embeddingsConfigured()) return [];
  try {
    const db = cmsDb();
    const matches = await matchDocuments(db, await embedQuery(question.slice(0, 400), signal), ["rating"], 40);
    const found = await loadBottles(db, matches.map(m => m.document_id));
    const { min, max } = priceLimits(question);
    const fits = recentFirst(matches.map(m => found.get(m.document_id)).filter((b): b is NonNullable<typeof b> => !!b && !have.has(b.slug))
      .filter(b => { const p = Number(b.rating.price) || 0; return (max == null || (p > 0 && p <= max)) && (min == null || p >= min); }), b => b.rating.issue, question);
    const strong = fits.filter(b => (b.rating.score ?? 0) >= 85), perHouse = new Map<string, number>();
    return (strong.length >= 6 ? strong : fits)
      .filter(b => { const house = (b.rating.brand || b.title.split(" ")[0]).toLowerCase(), n = perHouse.get(house) ?? 0; perHouse.set(house, n + 1); return n < 2; })
      .slice(0, 10)
      .map(b => ({ slug: b.slug, name: b.title, score: b.rating.score ?? 0, price: b.rating.price ?? null, category: b.rating.category || "", producer: b.rating.brand || "", year: reviewYear(b.rating.issue), note: b.flavor ? `${b.flavor.line} Notes: ${b.flavor.notes.join(", ")}` : "", how: "close in meaning to the question" }));
  } catch (error) {
    console.error("[wa/ask] meaning search", error instanceof Error ? error.message : error);
    return [];
  }
}

export function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (limited(ip)) return NextResponse.json({ error: "A lot of questions from this connection at once. Give it a minute." }, { status: 429, headers: CORS });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "Ask is not connected yet." }, { status: 503, headers: CORS });
  let body: { turns?: Turn[]; bottles?: Bottle[]; page?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Send JSON." }, { status: 400, headers: CORS }); }
  const turns = (Array.isArray(body.turns) ? body.turns : []).filter(t => t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string").slice(-10).map(t => ({ role: t.role, text: t.text.slice(0, 1200) }));
  if (!turns.length || turns[turns.length - 1].role !== "user") return NextResponse.json({ error: "Ask something first." }, { status: 400, headers: CORS });
  const bottles = (Array.isArray(body.bottles) ? body.bottles : []).slice(0, 14).map(b => ({ slug: String(b.slug || "").slice(0, 200), name: String(b.name || "").slice(0, 160), score: Number(b.score) || 0, price: b.price == null ? null : Number(b.price), category: String(b.category || "").slice(0, 60), producer: String(b.producer || "").slice(0, 80), year: Number(b.year) > 1900 ? Number(b.year) : null, note: String(b.note || "").slice(0, 260), how: String(b.how || "").slice(0, 40) }));
  const page = String(body.page || "").slice(0, 200);
  const added = await closeInMeaning(turns[turns.length - 1].text, new Set(bottles.map(b => b.slug)), request.signal);
  bottles.push(...added);

  const context = bottles.length
    ? "Bottles the site found for the latest question (slug | name | score | price | category | producer | year reviewed | how it relates to the page | note). When the reader says \"these\" or \"this story\", they mean the bottles marked as named in the text:\n" + bottles.map(b => `${b.slug} | ${b.name} | ${b.score} | ${b.price == null ? "price n/a" : "$" + b.price} | ${b.category} | ${b.producer} | ${b.year || "year n/a"} | ${b.how || ""} | ${b.note || ""}`).join("\n")
    : "The site found no bottles for the latest question.";
  const messages: Anthropic.MessageParam[] = turns.map((t, i) => ({ role: t.role, content: i === turns.length - 1 ? `${t.text}\n\n[${context}${page ? `\nThe reader is on: ${page}` : ""}]` : t.text }));

  try {
    const anthropic = new Anthropic();
    const message = await anthropic.messages.create({
      model: MODEL, max_tokens: 2000, system: SYSTEM, messages,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
    } as Anthropic.MessageCreateParamsNonStreaming);
    const text = message.content.map(c => (c.type === "text" ? c.text : "")).join("");
    const out = JSON.parse(text) as { answer: string; picks: string[]; followups: string[]; actions?: { type: string; slugs: string[]; title: string }[] };
    const known = new Set(bottles.map(b => b.slug));
    const picks = (out.picks || []).filter(s => known.has(s)).slice(0, 4);
    const max = { compare: 3, flight: 4, buy: 1, save: 1 } as Record<string, number>;
    const actions = (out.actions || []).filter(a => a && max[a.type]).map(a => ({ type: a.type, title: String(a.title || "").slice(0, 60), slugs: (a.slugs || []).filter(s => known.has(s)).slice(0, max[a.type]) }))
      .filter(a => a.slugs.length >= (a.type === "compare" ? 2 : a.type === "flight" ? 3 : 1)).slice(0, 2);
    const used = new Set([...picks, ...actions.flatMap(a => a.slugs)]);
    const cards = bottles.filter(b => used.has(b.slug)).map(({ slug, name, score, price, category }) => ({ slug, name, score, price, category }));
    return NextResponse.json({ answer: out.answer, picks, followups: (out.followups || []).slice(0, 3), actions, cards }, { headers: CORS });
  } catch (error) {
    console.error("[wa/ask]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "The assistant could not answer just now. Try again in a moment." }, { status: 502, headers: CORS });
  }
}
