import { NextResponse } from "next/server";
import { cmsDb } from "@/lib/cms/db";
import { onlyLive } from "@/lib/wa/live";
import { loadBottles, matchDocuments, rankSimilar, type Bottle } from "@/lib/wa/semantic";

export const runtime = "nodejs";
export const maxDuration = 15;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };
export function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

/**
 * Bottles like this rating: the hundred live ratings whose tasting notes read
 * closest by meaning, re-ranked by flavor profile and spread across houses.
 * A rating that is not live yet has no list (404), like its page.
 * Empty until the rating is embedded, and the page then keeps its own picks.
 */
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug")?.slice(0, 200) || "";
  if (!slug) return NextResponse.json({ error: "Which bottle?" }, { status: 400, headers: CORS });
  try {
    const db = cmsDb();
    const { data: doc } = await onlyLive(db.from("cms_documents").select("id,slug,title,rating:metadata->rating,flavor:metadata->flavor").eq("brand", "wa").eq("kind", "rating").eq("slug", slug)).maybeSingle();
    if (!doc) return NextResponse.json({ bottles: [] }, { status: 404, headers: CORS });
    const { data: own } = await db.from("cms_embeddings").select("embedding").eq("document_id", doc.id).eq("kind", "document").maybeSingle();
    if (!own?.embedding) return NextResponse.json({ bottles: [], reason: "not embedded yet" }, { headers: { ...CORS, "Cache-Control": "public, s-maxage=300" } });
    const matches = await matchDocuments(db, own.embedding as string, ["rating"], 100, doc.id);
    const bottles = await loadBottles(db, matches.map(m => m.document_id));
    const self = { ...doc, rating: doc.rating || {} } as Bottle;
    return NextResponse.json({ bottles: rankSimilar(self, matches, bottles), flavor: self.flavor }, { headers: { ...CORS, "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
  } catch (error) {
    console.error("[wa/bottles-like]", error instanceof Error ? error.message : error);
    return NextResponse.json({ bottles: [] }, { status: 502, headers: CORS });
  }
}
