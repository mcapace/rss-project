import type { SupabaseClient } from "@supabase/supabase-js";
import { embedTexts } from "@/lib/editorial/server/embeddings";
import { liveIds } from "./live";

/**
 * Meaning-based matching for the public Whisky Advocate site: ratings and
 * stories by embedding (wa_match_documents), and ratings by the structured
 * flavor profile each one carries in metadata.flavor.
 */
export const FLAVOR_AXES = ["smoke", "maritime", "sweet", "fresh_fruit", "dried_fruit", "tropical", "floral", "spice", "oak", "grain", "nutty", "herbal"] as const;
export type Flavor = { v: number; axes: Partial<Record<(typeof FLAVOR_AXES)[number], number>>; body: number; finish: number; notes: string[]; line: string };
export type RatingMeta = { brand?: string; category?: string; price?: number | null; score?: number; issue?: string; reviewer?: string };
export type Match = { document_id: string; kind: string; slug: string; title: string; similarity: number };
export type Bottle = { id: string; slug: string; title: string; rating: RatingMeta; flavor: Flavor | null };

const toVector = (embedding: number[] | string) => (typeof embedding === "string" ? embedding : `[${embedding.map(v => Number(v.toFixed(7))).join(",")}]`);

/**
 * The closest live documents of the given kinds. wa_match_documents skips scheduled stories inside the scan from
 * 20261103180000_wa_match_live_only.sql on; until that is applied (and as a guard after), the matched ids are
 * checked again here (isLive) and the rest dropped, asking for a few more so the list still fills.
 */
export async function matchDocuments(db: SupabaseClient, embedding: number[] | string, kinds: ("rating" | "article" | "legacy_record")[], limit: number, exclude?: string): Promise<Match[]> {
  const ask = Math.min(100, limit + Math.max(4, Math.ceil(limit / 5)));
  const { data, error } = await db.rpc("wa_match_documents", { p_query: toVector(embedding), p_kinds: kinds, p_limit: ask, p_exclude: exclude ?? null });
  if (error) throw new Error(error.message);
  const matches = ((data ?? []) as Match[]).map(m => ({ ...m, similarity: Number(m.similarity) }));
  if (!matches.length) return matches;
  const live = await liveIds(db, matches.map(m => m.document_id));
  return matches.filter(m => live.has(m.document_id)).slice(0, limit);
}

export async function embedQuery(query: string, signal?: AbortSignal): Promise<number[]> {
  const [embedding] = await embedTexts([query], "query", signal);
  return embedding;
}

export async function loadBottles(db: SupabaseClient, ids: string[]): Promise<Map<string, Bottle>> {
  if (!ids.length) return new Map();
  const { data, error } = await db.from("cms_documents").select("id,slug,title,rating:metadata->rating,flavor:metadata->flavor").in("id", ids);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as Bottle[]).map(b => [b.id, { ...b, rating: b.rating || {} }]));
}

/** Price limits a reader put in a question ("under $80", "over 200"); ages, proofs and scores ("over 12 years") are not prices. */
export function priceLimits(q: string): { min: number | null; max: number | null } {
  const num = (s: string) => Number(s.replace(/,/g, "").replace(/k$/i, "000"));
  const amount = String.raw`\s*\$?\s*(\d[\d,]*k?)\b(?!\s*-?\s*(?:years?|yrs?|yo|%|proof|abv|points?|pts))`;
  const max = new RegExp(String.raw`(?:under|below|less than|cheaper than|up to|<)` + amount, "i").exec(q);
  const min = new RegExp(String.raw`(?:over|above|more than|at least|>)` + amount, "i").exec(q);
  return { max: max ? num(max[1]) || null : null, min: min ? num(min[1]) || null : null };
}

/** Axes plus body and finish (doubled onto the 0-10 scale), so a light, short dram and a heavy, long one stay apart. */
export function flavorVector(f: Flavor): number[] {
  return [...FLAVOR_AXES.map(a => Number(f.axes?.[a]) || 0), (Number(f.body) || 3) * 2, (Number(f.finish) || 3) * 2];
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export type Similar = { slug: string; title: string; score: number | null; price: number | null; category: string; brand: string; line: string; shared: string[]; similarity: number };

/**
 * "Bottles like this": embedding candidates re-ranked by flavor profile, a small
 * nudge toward the same category, and at most `perBrand` from any one house so
 * the list reaches past the bottle's own distillery.
 */
export function rankSimilar(self: Bottle, matches: Match[], bottles: Map<string, Bottle>, options: { limit?: number; perBrand?: number } = {}): Similar[] {
  const limit = options.limit ?? 8, perBrand = options.perBrand ?? 2;
  const mine = self.flavor ? flavorVector(self.flavor) : null, myNotes = new Set(self.flavor?.notes ?? []);
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const ranked = matches.map(m => {
    const b = bottles.get(m.document_id);
    if (!b || norm(b.title) === norm(self.title)) return null;
    const taste = mine && b.flavor ? cosine(mine, flavorVector(b.flavor)) : null;
    const sameCategory = !!b.rating.category && b.rating.category === self.rating.category;
    const score = (taste == null ? m.similarity : 0.45 * m.similarity + 0.55 * taste) + (sameCategory ? 0.03 : 0);
    return { b, score };
  }).filter((x): x is { b: Bottle; score: number } => !!x).sort((a, b) => b.score - a.score);
  const perHouse = new Map<string, number>(), out: Similar[] = [];
  for (const { b, score } of ranked) {
    const house = norm(b.rating.brand || b.title.split(" ")[0]);
    if ((perHouse.get(house) ?? 0) >= perBrand) continue;
    perHouse.set(house, (perHouse.get(house) ?? 0) + 1);
    out.push({ slug: b.slug, title: b.title, score: b.rating.score ?? null, price: b.rating.price ?? null, category: b.rating.category || "", brand: b.rating.brand || "", line: b.flavor?.line || "", shared: (b.flavor?.notes ?? []).filter(n => myNotes.has(n)).slice(0, 3), similarity: Math.round(score * 1000) / 1000 });
    if (out.length >= limit) break;
  }
  return out;
}
