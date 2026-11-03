import { NextResponse } from "next/server";
import { cmsDb } from "@/lib/cms/db";
import { embeddingsConfigured } from "@/lib/editorial/server/embeddings";
import { closeMatches } from "@/lib/wa/meaning";
import { visitorKey, withinLimit } from "@/lib/wa/rate-limit";
import { embedQuery, matchDocuments, type Match } from "@/lib/wa/semantic";

export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * The search page's result lists by meaning: the reader's words embedded once and matched against every published
 * story and rating, so "something smoky for a cold night" finds the stories and bottles that never use those words.
 * No model call (the Answer panel is /api/wa/answer). Only matches close to the best one are kept, and the page adds
 * them after its own word matches. Cached at the edge per query.
 */
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };
export function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") || "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 160);
  if (q.length < 3) return NextResponse.json({ stories: [], bottles: [] }, { headers: CORS });
  if (!embeddingsConfigured()) return NextResponse.json({ stories: [], bottles: [], reason: "not configured" }, { headers: CORS });
  try {
    const db = cmsDb();
    // Shared across every server instance: 40 uncached searches a minute per visitor (cached ones never reach here).
    if (!(await withinLimit(db, `meaning:${visitorKey(request)}`, 40, 60))) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: CORS });
    const embedding = await embedQuery(q, request.signal);
    const [stories, bottles] = await Promise.all([matchDocuments(db, embedding, ["article"], 60), matchDocuments(db, embedding, ["rating"], 60)]);
    const out = (list: Match[]) => closeMatches(list).map(m => ({ slug: m.slug, similarity: Math.round(m.similarity * 1000) / 1000 }));
    return NextResponse.json({ stories: out(stories), bottles: out(bottles) }, { headers: { ...CORS, "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
  } catch (error) {
    console.error("[wa/meaning]", error instanceof Error ? error.message : error);
    return NextResponse.json({ stories: [], bottles: [] }, { status: 502, headers: CORS });
  }
}
