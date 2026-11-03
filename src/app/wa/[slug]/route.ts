import { NextResponse, type NextRequest } from "next/server";
import { resolveRedirect } from "@/lib/cms/redirects-server";
import { deliveryEnabled } from "@/lib/cms/runtime-config";
import { exportedPage } from "@/lib/wa/exported-content";
import { rootRedirect } from "@/lib/wa/root-routing";
import { loadDoc, notFoundPage, ratingView, renderRating, renderStory, sitePage, sitePageFile, storyView, template } from "@/lib/wa/seo";
import { redirectLookupHost, siteFor, withSearch, type WaSite } from "@/lib/wa/site-host";

export const runtime = "nodejs";
export const maxDuration = 20;

const PAGE_KINDS = new Set(["article", "legacy_record", "page", "collection_entry", "directory_entry"]);
const HTML = { "Content-Type": "text/html; charset=utf-8" };
// The edge keeps a page two minutes (so a saved correction shows quickly) and serves the old copy for a day while it refreshes.
const CACHE = "public, s-maxage=120, stale-while-revalidate=86400";
const MISSING = "public, s-maxage=60";

function notFound(site: WaSite, slug: string, cache = MISSING) {
  return new NextResponse(notFoundPage(site, slug), { status: 404, headers: { ...HTML, "Cache-Control": cache } });
}

/**
 * A root host's answer for a slug no published document has: the redirect engine, asked for "/<segment>" and then
 * "/wa/<segment>" (slug changes are stored in the /wa form). Whisky Advocate rows only, targets in their root form,
 * and a target that is this very path is a 404, never a redirect to itself.
 */
async function rootMiss(request: NextRequest, site: WaSite, raw: string, slug: string): Promise<NextResponse> {
  if (process.env.REDIRECTS_AT_EDGE === "false") return notFound(site, slug);
  // The segment as the browser sent it (the proxy's rewrite keeps the original URL), so the key matches the proxy's
  // multi-segment lookups and the importer's rows: re-encoding the decoded slug would turn "&" into "%26" and miss.
  const sent = /^\/[^/]+$/.exec(request.nextUrl.pathname)?.[0].slice(1) ?? raw;
  const requestPath = `/${sent}`;
  // The same lookup host as the proxy's multi-segment lookups, so a staging alias (REDIRECT_HOST_ALIASES) answers here too.
  const lookupHost = redirectLookupHost(request.headers.get("host") || new URL(request.url).host);
  try {
    for (const path of [requestPath, `/wa/${sent}`]) {
      const answer = rootRedirect(await resolveRedirect(path, lookupHost), requestPath);
      if (!answer) continue;
      if (answer.status === 410) return new NextResponse("This page has been retired.", { status: 410, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, s-maxage=300" } });
      if (answer.target) {
        const response = NextResponse.redirect(answer.target.startsWith("/") ? new URL(withSearch(answer.target, request.nextUrl.search), request.url) : new URL(answer.target), answer.status);
        response.headers.set("Cache-Control", "public, s-maxage=300");
        return response;
      }
    }
  } catch (error) {
    console.error("[wa/slug redirects]", error instanceof Error ? error.message : error);
    return notFound(site, slug, "no-store");
  }
  return notFound(site, slug);
}

/**
 * One Whisky Advocate story, rating or page, rendered on the server with its head tags and structured data
 * (src/lib/wa/seo.ts): /wa/<slug> on the development host, /<slug> on whiskyadvocate.com (the proxy rewrites it here;
 * the Host still says which shape to build).
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const raw = (await ctx.params).slug;
  let slug = raw;
  try { slug = decodeURIComponent(raw); } catch { /* keep as given */ }
  const site = siteFor(request);
  const { base } = site;
  // Previews do not read the production CMS (the platform's rule for public delivery): the static page shows the item.
  if (!deliveryEnabled() || !(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    const html = await exportedPage(slug, site);
    return new NextResponse(html || notFoundPage(site, slug), { status: html ? 200 : 404, headers: { ...HTML, "Cache-Control": CACHE } });
  }
  if (!slug || slug.length > 300 || /[\s<>"]/.test(slug)) return notFound(site, slug);

  let doc;
  try { doc = await loadDoc(slug); } catch (error) {
    console.error("[wa/slug]", error instanceof Error ? error.message : error);
    return new NextResponse(notFoundPage(site, slug), { status: 503, headers: { ...HTML, "Retry-After": "60", "Cache-Control": "no-store" } });
  }
  if (!doc) return site.root ? rootMiss(request, site, raw, slug) : notFound(site, slug);

  // One URL per document: a differently capitalized request goes to the canonical slug.
  if (doc.slug !== slug) return NextResponse.redirect(new URL(`${base}/${encodeURIComponent(doc.slug)}`, request.url), 301);

  // Served by a site page (metadata.page_file): the story's URL answers with that page of the site, such as the water tool.
  const pageFile = PAGE_KINDS.has(doc.kind) ? sitePageFile(doc.metadata) : null;
  const page = pageFile ? await sitePage(pageFile, storyView(doc, site), site) : null;
  if (page) return new NextResponse(page, { headers: { ...HTML, "Cache-Control": CACHE } });

  if (doc.kind === "rating") {
    return new NextResponse(renderRating(await template("bottle.html"), ratingView(doc, site), site), { headers: { ...HTML, "Cache-Control": CACHE } });
  }
  if (doc.kind === "product_review") {
    // The 90+ Club's spirits: their page on the new site.
    return NextResponse.redirect(new URL(`${base}/club.html#${encodeURIComponent(doc.slug)}`, request.url), 301);
  }
  if (doc.kind === "glossary_entry") {
    return NextResponse.redirect(new URL(`${base}/guides.html#glossaryBand`, request.url), 301);
  }
  if (PAGE_KINDS.has(doc.kind)) {
    return new NextResponse(renderStory(await template("story.html"), storyView(doc, site), site), { headers: { ...HTML, "Cache-Control": CACHE } });
  }
  return notFound(site, slug);
}
