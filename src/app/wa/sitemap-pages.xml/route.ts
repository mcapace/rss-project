import { siteFor } from "@/lib/wa/site-host";
import { SECTION_PAGES, XML, urlEntry, urlset } from "@/lib/wa/feeds";

export const runtime = "nodejs";

/** The site's section pages. */
export function GET(request: Request) {
  const { origin, base } = siteFor(request);
  return new Response(urlset(SECTION_PAGES.map(p => urlEntry(`${origin}${base}/${p}`, null))), { headers: { ...XML, "Cache-Control": "public, s-maxage=86400" } });
}
