import { NextResponse } from "next/server";
import { resolveFront } from "@/lib/cms/front-server";

export const runtime = "nodejs";
export const maxDuration = 15;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };

export function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

/**
 * The Whisky Advocate home page's news rotator: five positions, pinned where
 * an editor set one at /cms/front (a sponsored story, an older feature), the
 * newest stories elsewhere. The page merges these with its own story index
 * for pictures and links. Cached a minute at the edge.
 */
export async function GET() {
  try {
    const slots = await resolveFront("wa");
    const stories = slots.map(slot => {
      const s = slot.pinned || slot.fallback;
      return s ? { position: slot.position, id: s.id, slug: s.slug, title: s.title, by: s.byline, dek: s.excerpt, sec: s.section, d: s.date, hero: s.hero, pinned: Boolean(slot.pinned), label: slot.pinned?.label || "", ...(s.sponsored || slot.pinned?.label === "sponsored" ? { sp: 1, ...(s.sponsor ? { spBy: s.sponsor } : {}) } : {}) } : null;
    }).filter(Boolean);
    return NextResponse.json({ stories }, { headers: { ...CORS, "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
  } catch (error) {
    console.error("[wa/front]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "The front could not be read." }, { status: 502, headers: CORS });
  }
}
