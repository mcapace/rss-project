import { producerPage } from "@/lib/wa/exported-content";
import { notFoundPage, siteOrigin } from "@/lib/wa/seo";
export const runtime = "nodejs";
export async function GET(request: Request, context: {params:Promise<{name:string}>}) {
  const { name } = await context.params;
  const origin = siteOrigin(request), html = await producerPage(name,origin);
  return new Response(html || notFoundPage(origin,name),{status:html ? 200 : 404,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"public, s-maxage=600, stale-while-revalidate=86400"}});
}
