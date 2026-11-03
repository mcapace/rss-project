import { docDates } from "@/lib/wa/seo";
import { siteFor } from "@/lib/wa/site-host";
import { HOURLY, XML, ratingDocs, urlEntry, urlset } from "@/lib/wa/feeds";

import { deliveryEnabled } from "@/lib/cms/runtime-config";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Every published rating at its own URL (/<slug> on whiskyadvocate.com, /wa/<slug> elsewhere). */
export async function GET(request: Request) {
  if (!deliveryEnabled()) return new Response("Not available on preview deployments.", { status: 503, headers: { "Cache-Control": "no-store" } });
  const { origin, base } = siteFor(request);
  try {
    const docs = await ratingDocs();
    return new Response(urlset(docs.map(d => { const t = docDates(d); return urlEntry(`${origin}${base}/${encodeURIComponent(d.slug)}`, t.modified ?? t.published); })), { headers: { ...XML, "Cache-Control": HOURLY } });
  } catch (error) {
    console.error("[wa/sitemap-ratings]", error instanceof Error ? error.message : error);
    return new Response("Sitemap unavailable", { status: 503, headers: { "Retry-After": "300", "Cache-Control": "no-store" } });
  }
}
