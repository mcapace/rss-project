import { siteOrigin, docDates } from "@/lib/wa/seo";
import { IMAGE_NS, NEWS_CACHE, NEWS_NS, XML, isSponsored, listDocsForNews, newsEntry, urlset } from "@/lib/wa/feeds";

import { deliveryEnabled } from "@/lib/cms/runtime-config";

export const runtime = "nodejs";
export const maxDuration = 20;

/** Google News: editorial stories published in the last two days (Google's window), never paid content. */
export async function GET(request: Request) {
  if (!deliveryEnabled()) return new Response("Not available on preview deployments.", { status: 503, headers: { "Cache-Control": "no-store" } });
  const origin = siteOrigin(request);
  try {
    const cutoff = Date.now() - 2 * 86400_000;
    const docs = (await listDocsForNews()).filter(d => { const p = docDates(d).published; return !!p && Date.parse(p) >= cutoff && !isSponsored(d); });
    return new Response(urlset(docs.map(d => newsEntry(origin, d)), NEWS_NS + IMAGE_NS), { headers: { ...XML, "Cache-Control": NEWS_CACHE } });
  } catch (error) {
    console.error("[wa/news-sitemap]", error instanceof Error ? error.message : error);
    return new Response("Sitemap unavailable", { status: 503, headers: { "Retry-After": "120", "Cache-Control": "no-store" } });
  }
}
