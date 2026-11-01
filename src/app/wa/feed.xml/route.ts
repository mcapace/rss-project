import { BASE, PUBLISHER, docDates, heroOf, sectionLabels, siteOrigin, xmlEsc } from "@/lib/wa/seo";
import { isSponsored, listDocsForNews, rfc822 } from "@/lib/wa/feeds";

import { deliveryEnabled } from "@/lib/cms/runtime-config";

export const runtime = "nodejs";
export const maxDuration = 20;

/** RSS 2.0: the 50 newest editorial stories, with summary, author, section and lead picture. */
export async function GET(request: Request) {
  if (!deliveryEnabled()) return new Response("Not available on preview deployments.", { status: 503, headers: { "Cache-Control": "no-store" } });
  const origin = siteOrigin(request);
  try {
    const docs = (await listDocsForNews()).filter(d => !isSponsored(d)).slice(0, 50);
    const items = docs.map(d => {
      const link = `${origin}${BASE}/${encodeURIComponent(d.slug)}`;
      const meta = d.metadata as Record<string, unknown>;
      const seo = (meta.seo && typeof meta.seo === "object" ? meta.seo : {}) as Record<string, unknown>;
      const summary = String(seo.description || d.excerpt || meta.ai_summary || "").replace(/<[^>]+>/g, "").trim();
      const cats = sectionLabels(meta.categories);
      const hero = heroOf(d, origin);
      return `<item><title>${xmlEsc(d.title)}</title><link>${xmlEsc(link)}</link><guid isPermaLink="true">${xmlEsc(link)}</guid><pubDate>${rfc822(docDates(d).published)}</pubDate>${d.byline ? `<dc:creator>${xmlEsc(d.byline)}</dc:creator>` : ""}${cats.map(c => `<category>${xmlEsc(c)}</category>`).join("")}<description>${xmlEsc(summary)}</description>${hero ? `<media:content url="${xmlEsc(hero)}" medium="image"/>` : ""}</item>`;
    });
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${PUBLISHER}</title><link>${origin}${BASE}/</link><atom:link href="${origin}${BASE}/feed.xml" rel="self" type="application/rss+xml"/><description>Whisky ratings, news, guides and stories from ${PUBLISHER}.</description><language>en-us</language><lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n${items.join("\n")}\n</channel></rss>\n`;
    return new Response(body, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" } });
  } catch (error) {
    console.error("[wa/feed]", error instanceof Error ? error.message : error);
    return new Response("Feed unavailable", { status: 503, headers: { "Retry-After": "120", "Cache-Control": "no-store" } });
  }
}
