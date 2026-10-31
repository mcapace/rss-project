import { NextResponse } from "next/server";
import { cmsDb } from "@/lib/cms/db";

export const runtime = "nodejs";
export const maxDuration = 15;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };
export function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

/**
 * Stories like this one, by meaning: the story's own embedding against every
 * other published story's (pgvector, built by the embed maintenance task).
 * Returns ids and slugs; the page fills in titles and pictures from its index.
 * Empty until the stories are embedded, and the page then keeps its own guess.
 */
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug")?.slice(0, 200) || "";
  if (!slug) return NextResponse.json({ error: "Which story?" }, { status: 400, headers: CORS });
  try {
    const db = cmsDb();
    const { data: doc } = await db.from("cms_documents").select("id").eq("brand", "wa").eq("kind", "article").eq("slug", slug).maybeSingle();
    if (!doc) return NextResponse.json({ stories: [] }, { headers: CORS });
    const { data: own } = await db.from("cms_embeddings").select("embedding").eq("document_id", doc.id).eq("kind", "document").maybeSingle();
    if (!own?.embedding) return NextResponse.json({ stories: [], reason: "not embedded yet" }, { headers: { ...CORS, "Cache-Control": "public, s-maxage=300" } });
    const { data: matches, error } = await db.rpc("cms_match_embeddings", { p_brands: ["wa"], p_query: own.embedding, p_kind: "document", p_limit: 12 });
    if (error) throw error;
    const ids = ((matches || []) as { document_id: string; similarity: number; publication_state: string }[]).filter(m => m.document_id !== doc.id && m.publication_state === "published").slice(0, 8);
    if (!ids.length) return NextResponse.json({ stories: [] }, { headers: CORS });
    const { data: docs } = await db.from("cms_documents").select("id,slug").in("id", ids.map(m => m.document_id));
    const slugOf = new Map((docs || []).map(d => [d.id, d.slug]));
    return NextResponse.json({ stories: ids.map(m => ({ id: m.document_id, slug: slugOf.get(m.document_id) || null, similarity: Math.round(m.similarity * 1000) / 1000 })).filter(s => s.slug) }, { headers: { ...CORS, "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
  } catch (error) {
    console.error("[wa/similar]", error instanceof Error ? error.message : error);
    return NextResponse.json({ stories: [] }, { status: 502, headers: CORS });
  }
}
