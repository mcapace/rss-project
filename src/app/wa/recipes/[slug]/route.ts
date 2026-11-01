import { recipePage } from "@/lib/wa/exported-content";
import { notFoundPage, siteOrigin } from "@/lib/wa/seo";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{slug:string}> }) {
  const { slug } = await context.params;
  const origin = siteOrigin(request);
  const html = await recipePage(slug, origin);
  return new Response(html || notFoundPage(origin,slug), {status:html ? 200 : 404,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"public, s-maxage=600, stale-while-revalidate=86400"}});
}
