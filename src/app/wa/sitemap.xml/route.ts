import { XML, sitemapIndex } from "@/lib/wa/feeds";
import { siteFor } from "@/lib/wa/site-host";

export const runtime = "nodejs";

/** The sitemap index: stories (with their pictures), ratings, and the site's section pages. */
export function GET(request: Request) {
  return new Response(sitemapIndex(siteFor(request)), { headers: { ...XML, "Cache-Control": "public, s-maxage=3600" } });
}
