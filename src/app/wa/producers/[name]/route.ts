import { producerPage } from "@/lib/wa/exported-content";
import { notFoundPage } from "@/lib/wa/seo";
import { siteFor } from "@/lib/wa/site-host";
export const runtime = "nodejs";
export async function GET(request: Request, context: {params:Promise<{name:string}>}) {
  const { name } = await context.params;
  const site = siteFor(request), html = await producerPage(name,site);
  return new Response(html || notFoundPage(site,name),{status:html ? 200 : 404,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"public, s-maxage=600, stale-while-revalidate=86400"}});
}
