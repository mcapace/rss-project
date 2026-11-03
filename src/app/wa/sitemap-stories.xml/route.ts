import { siteFor } from "@/lib/wa/site-host";
import { HOURLY, IMAGE_NS, XML, storyDocs, storyEntry, urlset } from "@/lib/wa/feeds";

import { deliveryEnabled } from "@/lib/cms/runtime-config";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Every published story and page at its own URL (/<slug> on whiskyadvocate.com, /wa/<slug> elsewhere), with its lead picture. */
export async function GET(request: Request) {
  if (!deliveryEnabled()) return new Response("Not available on preview deployments.", { status: 503, headers: { "Cache-Control": "no-store" } });
  const site = siteFor(request);
  try {
    const docs = await storyDocs();
    return new Response(urlset(docs.map(d => storyEntry(site, d)), IMAGE_NS), { headers: { ...XML, "Cache-Control": HOURLY } });
  } catch (error) {
    console.error("[wa/sitemap-stories]", error instanceof Error ? error.message : error);
    return new Response("Sitemap unavailable", { status: 503, headers: { "Retry-After": "300", "Cache-Control": "no-store" } });
  }
}
