import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { cmsDb } from "@/lib/cms/db";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Shelf scan for the Whisky Advocate site: a photo of a shelf comes in, Claude
 * reads the labels, and each legible bottle is matched to a published rating.
 * Public, rate limited per address, nothing stored. The same vision capability
 * that describes images for the CMS asset search.
 */
const MODEL = process.env.SHELF_SCAN_MODEL || "claude-sonnet-5-5";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const WINDOW_MS = 60_000;
const PER_WINDOW = 12;
const hits = new Map<string, { count: number; until: number }>();

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["bottles"],
  properties: { bottles: { type: "array", maxItems: 24, items: {
    type: "object", additionalProperties: false, required: ["brand", "name", "confidence", "x", "y", "w", "h"],
    properties: {
      brand: { type: "string" }, name: { type: "string" }, age: { type: "string" }, abv: { type: "string" },
      confidence: { type: "number" }, x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" },
    } } } },
};

type Seen = { brand: string; name: string; age?: string; abv?: string; confidence: number; x: number; y: number; w: number; h: number };
type Rating = { product_name: string; category: string; score: number; price: number | null; slug: string | null; published: string | null };

function limited(ip: string): boolean {
  const now = Date.now(); const entry = hits.get(ip);
  if (!entry || entry.until < now) { hits.set(ip, { count: 1, until: now + WINDOW_MS }); return false; }
  entry.count += 1; return entry.count > PER_WINDOW;
}

const STOP = new Set(["the", "and", "of", "whisky", "whiskey", "bourbon", "scotch", "single", "malt", "straight", "kentucky", "rye", "old", "year", "years", "yr", "distillery", "reserve", "edition", "release", "batch"]);
function tokens(text: string): string[] { return text.toLowerCase().replace(/[^a-z0-9%. ]+/g, " ").split(/\s+/).filter(t => t && !STOP.has(t)); }

/** Rank the candidate ratings for one label by shared words, favouring the newest review. */
function best(seen: Seen, rows: Rating[]): Rating | null {
  const want = new Set(tokens(`${seen.brand} ${seen.name} ${seen.age ?? ""} ${seen.abv ?? ""}`));
  let top: { row: Rating; score: number } | null = null;
  for (const row of rows) {
    const have = tokens(row.product_name);
    const shared = have.filter(t => want.has(t)).length;
    const score = shared * 2 - Math.max(0, have.length - shared) * 0.15 + (row.published ?? "").slice(0, 4).localeCompare("2000") * 0.001;
    if (shared === 0) continue;
    if (!top || score > top.score) top = { row, score };
  }
  return top?.row ?? null;
}

export async function POST(request: Request) {
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return NextResponse.json({ error: "Too many scans from this address. Try again in a minute." }, { status: 429 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "Shelf scan is not connected on this server." }, { status: 503 });
  let body: { image?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Send a JSON body with an image data URL." }, { status: 422 }); }
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(body.image ?? "");
  if (!match) return NextResponse.json({ error: "The image must be a JPEG, PNG or WebP data URL." }, { status: 422 });
  if (match[2].length * 0.75 > MAX_IMAGE_BYTES) return NextResponse.json({ error: "The photo is too large. Keep it under 5 MB." }, { status: 413 });

  const anthropic = new Anthropic();
  const message = await anthropic.messages.create({
    model: MODEL, max_tokens: 2000,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
    system: "You read whisky labels in shelf photographs for a ratings lookup. List every bottle whose brand is legible. Give the brand as printed, the expression name without the brand (for example '10 Year Old', 'Small Batch', 'Blue Label'), the age statement and ABV when printed, a confidence from 0 to 1, and the bottle's bounding box as fractions of the image width and height (x, y of the top-left corner, w, h). Leave out bottles you cannot read.",
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: match[1] as "image/jpeg" | "image/png" | "image/webp", data: match[2] } },
      { type: "text", text: "Read the labels on this shelf." },
    ] }],
  });
  let seen: Seen[] = [];
  try { seen = (JSON.parse(message.content.map(block => (block.type === "text" ? block.text : "")).join("")) as { bottles: Seen[] }).bottles ?? []; }
  catch { return NextResponse.json({ error: "The labels could not be read. Try a closer, sharper photo." }, { status: 502 }); }
  seen = seen.filter(b => b.brand && b.confidence >= 0.35).slice(0, 24);

  const db = cmsDb();
  const results = [];
  for (const bottle of seen) {
    const brandWord = tokens(bottle.brand)[0] ?? bottle.brand.toLowerCase();
    const { data } = await db.from("cms_ratings").select("product_name,category,score,price,cms_documents!inner(slug,publication_state,metadata)")
      .eq("brand", "wa").eq("cms_documents.publication_state", "published").ilike("product_name", `%${brandWord.replace(/[%_]/g, "")}%`).limit(60);
    const rows: Rating[] = (data ?? []).map(row => {
      const doc = Array.isArray(row.cms_documents) ? row.cms_documents[0] : row.cms_documents;
      const meta = (doc?.metadata ?? {}) as { legacy_dates?: { published_date?: string } };
      return { product_name: row.product_name, category: row.category, score: row.score, price: row.price == null ? null : Number(row.price), slug: doc?.slug ?? null, published: meta.legacy_dates?.published_date ?? null };
    });
    const hit = best(bottle, rows);
    results.push({ label: `${bottle.brand} ${bottle.name}`.trim(), confidence: bottle.confidence, box: { x: bottle.x, y: bottle.y, w: bottle.w, h: bottle.h },
      rating: hit ? { name: hit.product_name, score: hit.score, price: hit.price, category: hit.category, slug: hit.slug, reviewed: hit.published } : null });
  }
  const rated = results.filter(r => r.rating && r.rating.price && r.rating.price > 0);
  const bestValue = rated.length ? rated.reduce((a, b) => (value(b.rating!) > value(a.rating!) ? b : a)) : null;
  return NextResponse.json({ bottles: results, best_value: bestValue ? bestValue.label : null }, { headers: { "Cache-Control": "no-store" } });
}

function value(r: { score: number; price: number | null }): number { return r.score - 80 - Math.log((r.price && r.price > 0 ? r.price : 60) / 30) * 4; }
