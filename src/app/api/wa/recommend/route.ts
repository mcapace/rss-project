import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { cmsDb } from "@/lib/cms/db";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Bottle recommendations for a story or a cocktail on the public site. The
 * page sends what it is about (title, a summary or the recipe) and the
 * candidates its own index found (bottles named in the text, the house the
 * story is about, the style it covers), and Claude chooses the ones a reader
 * would actually want next to that page, with a line of why for each. Results
 * are cached by content and candidates, so a page costs one call until it or
 * its candidates change.
 */
const MODEL = process.env.WA_RECOMMEND_MODEL || "claude-sonnet-5-5";
const PROMPT_VERSION = "1";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const bucket = new Map<string, { count: number; at: number }>();

function limited(ip: string) {
  const now = Date.now(); const hit = bucket.get(ip);
  if (!hit || now - hit.at > 60_000) { bucket.set(ip, { count: 1, at: now }); return false; }
  hit.count += 1; return hit.count > 40;
}

type Candidate = { slug: string; name: string; score: number; price: number | null; category: string; producer: string; note?: string; how?: string };
type Body = { kind?: string; slug?: string; title?: string; summary?: string; ingredients?: string[]; candidates?: Candidate[] };

const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    line: { type: "string", description: "One sentence, under 22 words, introducing the picks in the magazine's voice. Plain prose, no exclamation marks." },
    picks: { type: "array", items: { type: "object", additionalProperties: false, properties: { slug: { type: "string" }, why: { type: "string", description: "Under 18 words: why this bottle belongs with this page. Specific, never generic." } }, required: ["slug", "why"] }, description: "Best first, at most four, only slugs from the candidates, and only bottles that truly belong. An empty list is right when none does." },
  },
  required: ["line", "picks"],
};

const SYSTEM = `You choose the bottles shown beside a page on whiskyadvocate.com. You are a careful editor: a reader must never see a bottle that has nothing to do with what they are reading.

Rules, in order:
1. A bottle the text names, reviews or discusses comes first, even if other candidates score higher.
2. Then bottles from the house the page is about (the same producer or brand), newest or most relevant expression first.
3. Only then bottles of the exact style the page is about, and only when the page is about that style (a story about Islay single malts can show Islay single malts; a story about a distillery tour or an auction should not show random bourbons).
4. For a cocktail: the bottle the recipe names first; otherwise bottles that fit the role in the drink (the right whisky type, a proof that stands up to mixing, a price that makes sense for mixing); a $500 bottle does not go in a highball.
5. Never pad. Two right picks beat four loose ones. If nothing fits, return no picks and say in the line that the archive has no close match.
Use scores and prices exactly as given. No em dashes. Return only the JSON asked for.`;

export function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (limited(ip)) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: CORS });
  let body: Body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Send JSON." }, { status: 400, headers: CORS }); }
  const kind = body.kind === "cocktail" ? "cocktail" : body.kind === "story" ? "story" : null;
  const slug = String(body.slug || "").slice(0, 200);
  if (!kind || !slug) return NextResponse.json({ error: "Say what the page is." }, { status: 400, headers: CORS });
  const title = String(body.title || "").slice(0, 200);
  const summary = String(body.summary || "").replace(/\s+/g, " ").slice(0, 2200);
  const ingredients = (Array.isArray(body.ingredients) ? body.ingredients : []).map(i => String(i).slice(0, 120)).slice(0, 16);
  const candidates: Candidate[] = (Array.isArray(body.candidates) ? body.candidates : []).slice(0, 24).map(c => ({ slug: String(c.slug || "").slice(0, 200), name: String(c.name || "").slice(0, 160), score: Number(c.score) || 0, price: c.price == null ? null : Number(c.price), category: String(c.category || "").slice(0, 60), producer: String(c.producer || "").slice(0, 80), note: String(c.note || "").slice(0, 240), how: String(c.how || "").slice(0, 40) })).filter(c => c.slug && c.name);
  if (!candidates.length) return NextResponse.json({ line: "", picks: [], cached: true }, { headers: CORS });

  const key = createHash("sha256").update([PROMPT_VERSION, kind, slug, title, summary, ingredients.join("|"), candidates.map(c => c.slug).sort().join(",")].join("\n")).digest("hex");
  const db = cmsDb();
  const { data: hit } = await db.from("wa_recommendations").select("line,items").eq("key", key).maybeSingle();
  if (hit) return NextResponse.json({ line: hit.line, picks: hit.items, cached: true }, { headers: { ...CORS, "Cache-Control": "public, s-maxage=600" } });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "Recommendations are not connected yet." }, { status: 503, headers: CORS });

  const page = kind === "cocktail"
    ? `A cocktail recipe: "${title}"\nIngredients:\n${ingredients.map(i => "- " + i).join("\n")}\n${summary ? "About it: " + summary : ""}`
    : `A story: "${title}"\n${summary}`;
  const list = candidates.map(c => `${c.slug} | ${c.name} | ${c.score} pts | ${c.price == null ? "price n/a" : "$" + c.price} | ${c.category} | ${c.producer}${c.how ? " | found: " + c.how : ""}${c.note ? " | " + c.note : ""}`).join("\n");
  try {
    const anthropic = new Anthropic();
    const message = await anthropic.messages.create({
      model: MODEL, max_tokens: 600, system: SYSTEM,
      messages: [{ role: "user", content: `${page}\n\nCandidates (slug | name | score | price | category | producer | how the page found it | note):\n${list}` }],
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
    } as Anthropic.MessageCreateParamsNonStreaming);
    const text = message.content.map(c => (c.type === "text" ? c.text : "")).join("");
    const out = JSON.parse(text) as { line: string; picks: { slug: string; why: string }[] };
    const known = new Set(candidates.map(c => c.slug));
    const picks = (out.picks || []).filter(p => p && known.has(p.slug)).slice(0, 4).map(p => ({ slug: p.slug, why: String(p.why || "").slice(0, 160) }));
    const line = String(out.line || "").slice(0, 220);
    await db.from("wa_recommendations").upsert({ key, kind, slug, line, items: picks, model: MODEL });
    return NextResponse.json({ line, picks, cached: false }, { headers: CORS });
  } catch (error) {
    console.error("[wa/recommend]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No recommendation just now." }, { status: 502, headers: CORS });
  }
}
