import { NextResponse } from "next/server";
import { cmsDb } from "@/lib/cms/db";
import { onlyLive } from "@/lib/wa/live";
import { matchDocuments } from "@/lib/wa/semantic";

export const runtime = "nodejs";
export const maxDuration = 15;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };
export function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

/**
 * Stories like this one, by meaning: the story's own embedding against every
 * other live story's (pgvector, built by the embed maintenance task), through
 * wa_match_documents, which filters inside the scan. Returns ids and slugs; the
 * page fills in titles and pictures from its index. Empty until the stories are
 * embedded, and the page then keeps its own guess. A scheduled story is not out
 * yet (its page is a 404), so it has no list and never appears in another's.
 */
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug")?.slice(0, 200) || "";
  if (!slug) return NextResponse.json({ error: "Which story?" }, { status: 400, headers: CORS });
  try {
    const db = cmsDb();
    const { data: doc } = await onlyLive(db.from("cms_documents").select("id").eq("brand", "wa").eq("kind", "article").eq("slug", slug)).maybeSingle();
    if (!doc) return NextResponse.json({ stories: [] }, { headers: CORS });
    const { data: own } = await db.from("cms_embeddings").select("embedding").eq("document_id", doc.id).eq("kind", "document").maybeSingle();
    if (!own?.embedding) return NextResponse.json({ stories: [], reason: "not embedded yet" }, { headers: { ...CORS, "Cache-Control": "public, s-maxage=300" } });
    // matchDocuments re-checks every match's liveness, so this holds before 20261103180000_wa_match_live_only.sql too.
    const matches = (await matchDocuments(db, own.embedding as string, ["article", "legacy_record"], 12, doc.id)).filter(m => m.document_id !== doc.id && m.slug).slice(0, 8);
    if (!matches.length) return NextResponse.json({ stories: [] }, { headers: CORS });
    return NextResponse.json({ stories: matches.map(m => ({ id: m.document_id, slug: m.slug, similarity: Math.round(m.similarity * 1000) / 1000 })) }, { headers: { ...CORS, "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
  } catch (error) {
    console.error("[wa/similar]", error instanceof Error ? error.message : error);
    return NextResponse.json({ stories: [] }, { status: 502, headers: CORS });
  }
}
