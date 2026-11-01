import { NextResponse } from "next/server";
import { cmsDb } from "@/lib/cms/db";
import { leadImagePath } from "@/lib/cms/lead-image";
import { sponsorship } from "@/lib/cms/sponsored";

export const runtime = "nodejs";
export const maxDuration = 15;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };
export function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

const SECTION: Record<string, string> = { News: "news", Features: "features", Insights: "features", "Whisky Life": "life", Travel: "travel", Cocktails: "cocktails", Guides: "guides" };

/**
 * One published story straight from the CMS, for a story the site's index has
 * not been exported with yet (anything newer than the last export). The page
 * asks for it only when the slug is in neither the index nor the archive.
 */
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug")?.slice(0, 200) || "";
  if (!slug) return NextResponse.json({ error: "Which story?" }, { status: 400, headers: CORS });
  try {
    const { data } = await cmsDb().from("cms_documents").select("id,slug,title,byline,excerpt,body_html,metadata").eq("brand", "wa").eq("kind", "article").eq("publication_state", "published").ilike("slug", slug).limit(1).maybeSingle();
    if (!data) return NextResponse.json({ error: "No such story." }, { status: 404, headers: { ...CORS, "Cache-Control": "public, s-maxage=60" } });
    const meta = (data.metadata || {}) as Record<string, unknown>;
    const dates = (meta.legacy_dates && typeof meta.legacy_dates === "object" ? meta.legacy_dates : {}) as Record<string, unknown>;
    const date = typeof dates.published_date === "string" ? dates.published_date.slice(0, 10) : null;
    const cats = Array.isArray(meta.categories) ? meta.categories.filter((c): c is string => typeof c === "string") : [];
    const tags = Array.isArray(meta.ai_tags) ? (meta.ai_tags as unknown[]).filter((t): t is string => typeof t === "string") : Array.isArray(meta.tags) ? (meta.tags as unknown[]).filter((t): t is string => typeof t === "string" && !cats.includes(t)) : [];
    const seo = (meta.seo && typeof meta.seo === "object" ? meta.seo : {}) as Record<string, unknown>;
    const story = { id: data.id, slug: data.slug, title: data.title, by: data.byline, d: date, sec: SECTION[cats[0]] || "news", hero: leadImagePath(data.id, meta) || "", dek: typeof seo.description === "string" && seo.description ? seo.description : data.excerpt, tags, refs: [], ...(() => { const sp = sponsorship(meta, data.byline); return sp.on ? { sp: 1, ...(sp.by ? { spBy: sp.by } : {}) } : {}; })(), min: String(Math.max(1, Math.round(String(data.body_html || "").replace(/<[^>]+>/g, " ").split(/\s+/).length / 230))) };
    return NextResponse.json({ story, body: data.body_html || "" }, { headers: { ...CORS, "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } });
  } catch (error) {
    console.error("[wa/story]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "The story could not be read." }, { status: 502, headers: CORS });
  }
}
