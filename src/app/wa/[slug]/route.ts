import { NextResponse, type NextRequest } from "next/server";
import { deliveryEnabled } from "@/lib/cms/runtime-config";
import { exportedPage } from "@/lib/wa/exported-content";
import { BASE, loadDoc, notFoundPage, ratingView, renderRating, renderStory, siteOrigin, storyView, template } from "@/lib/wa/seo";

export const runtime = "nodejs";
export const maxDuration = 20;

const PAGE_KINDS = new Set(["article", "legacy_record", "page", "collection_entry", "directory_entry"]);
const HTML = { "Content-Type": "text/html; charset=utf-8" };
// Pages change rarely; the edge keeps them ten minutes and serves the old copy for a day while it refreshes.
const CACHE = "public, s-maxage=600, stale-while-revalidate=86400";

/**
 * /wa/<slug>: one Whisky Advocate story, rating or page, rendered on the server with its head tags and
 * structured data (src/lib/wa/seo.ts). Every legacy whiskyadvocate.com URL redirects here.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const raw = (await ctx.params).slug;
  let slug = raw;
  try { slug = decodeURIComponent(raw); } catch { /* keep as given */ }
  const origin = siteOrigin(request);
  // Previews do not read the production CMS (the platform's rule for public delivery): the static page shows the item.
  if (!deliveryEnabled() || !(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    const html = await exportedPage(slug, origin);
    return new NextResponse(html || notFoundPage(origin, slug), { status: html ? 200 : 404, headers: { ...HTML, "Cache-Control": CACHE } });
  }
  if (!slug || slug.length > 300 || /[\s<>"]/.test(slug)) return new NextResponse(notFoundPage(origin, slug), { status: 404, headers: { ...HTML, "Cache-Control": "public, s-maxage=300" } });

  let doc;
  try { doc = await loadDoc(slug); } catch (error) {
    console.error("[wa/slug]", error instanceof Error ? error.message : error);
    return new NextResponse(notFoundPage(origin, slug), { status: 503, headers: { ...HTML, "Retry-After": "60", "Cache-Control": "no-store" } });
  }
  if (!doc) return new NextResponse(notFoundPage(origin, slug), { status: 404, headers: { ...HTML, "Cache-Control": "public, s-maxage=300" } });

  // One URL per document: a differently capitalized request goes to the canonical slug.
  if (doc.slug !== slug) return NextResponse.redirect(new URL(`${BASE}/${encodeURIComponent(doc.slug)}`, request.url), 301);

  if (doc.kind === "rating") {
    return new NextResponse(renderRating(await template("bottle.html"), ratingView(doc, origin), origin), { headers: { ...HTML, "Cache-Control": CACHE } });
  }
  if (doc.kind === "product_review") {
    // The 90+ Club's spirits: their page on the new site.
    return NextResponse.redirect(new URL(`${BASE}/club.html#${encodeURIComponent(doc.slug)}`, request.url), 301);
  }
  if (doc.kind === "glossary_entry") {
    return NextResponse.redirect(new URL(`${BASE}/guides.html#glossaryBand`, request.url), 301);
  }
  if (PAGE_KINDS.has(doc.kind)) {
    return new NextResponse(renderStory(await template("story.html"), storyView(doc, origin), origin), { headers: { ...HTML, "Cache-Control": CACHE } });
  }
  return new NextResponse(notFoundPage(origin, slug), { status: 404, headers: { ...HTML, "Cache-Control": "public, s-maxage=300" } });
}
