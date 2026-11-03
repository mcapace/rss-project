import { producerPage } from "@/lib/wa/exported-content";
import { removedRatingSlugs } from "@/lib/wa/live-stories";
import { notFoundPage } from "@/lib/wa/seo";
import { siteFor } from "@/lib/wa/site-host";
export const runtime = "nodejs";
const CACHE = "public, s-maxage=600, stale-while-revalidate=86400";
export async function GET(request: Request, context: {params:Promise<{name:string}>}) {
  const { name } = await context.params;
  // Ratings taken down since the export leave the page (its bottle links, its count). If the CMS cannot say which,
  // the page is the static export as before, kept a minute so the next request asks again.
  let removed = new Set<string>(), cache = CACHE;
  try { removed = await removedRatingSlugs(); } catch (error) {
    console.error("[wa/producers] takedowns unreadable", error instanceof Error ? error.message : error);
    cache = "public, s-maxage=60";
  }
  const site = siteFor(request), html = await producerPage(name,site,removed);
  return new Response(html || notFoundPage(site,name),{status:html ? 200 : 404,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":cache}});
}
