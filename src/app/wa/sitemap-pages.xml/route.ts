import { siteFor } from "@/lib/wa/site-host";
import { SECTION_PAGES, XML, urlEntry, urlset } from "@/lib/wa/feeds";
import { barUrls } from "@/lib/wa/bars";

export const runtime = "nodejs";

/** The site's section pages, and America's Top Whisky Bars with a page per state and per bar. */
export async function GET(request: Request) {
  const site = siteFor(request), { origin, base } = site;
  const bars = await barUrls(site).catch(() => [] as string[]);
  return new Response(urlset([...SECTION_PAGES.map(p => urlEntry(`${origin}${base}/${p}`, null)), ...bars.map(u => urlEntry(u, null))]), { headers: { ...XML, "Cache-Control": "public, s-maxage=86400" } });
}
