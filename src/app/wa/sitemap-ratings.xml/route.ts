import { BASE, docDates, siteOrigin } from "@/lib/wa/seo";
import { HOURLY, XML, ratingDocs, urlEntry, urlset } from "@/lib/wa/feeds";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Every published rating at its /wa/<slug> URL. */
export async function GET(request: Request) {
  const origin = siteOrigin(request);
  try {
    const docs = await ratingDocs();
    return new Response(urlset(docs.map(d => { const t = docDates(d); return urlEntry(`${origin}${BASE}/${encodeURIComponent(d.slug)}`, t.modified ?? t.published); })), { headers: { ...XML, "Cache-Control": HOURLY } });
  } catch (error) {
    console.error("[wa/sitemap-ratings]", error instanceof Error ? error.message : error);
    return new Response("Sitemap unavailable", { status: 503, headers: { "Retry-After": "300", "Cache-Control": "no-store" } });
  }
}
