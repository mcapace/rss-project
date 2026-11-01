import { BASE, siteOrigin } from "@/lib/wa/seo";
import { SECTION_PAGES, XML, urlEntry, urlset } from "@/lib/wa/feeds";

export const runtime = "nodejs";

/** The site's section pages. */
export function GET(request: Request) {
  const origin = siteOrigin(request);
  return new Response(urlset(SECTION_PAGES.map(p => urlEntry(`${origin}${BASE}/${p}`, null))), { headers: { ...XML, "Cache-Control": "public, s-maxage=86400" } });
}
