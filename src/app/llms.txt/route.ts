import { BASE, PUBLISHER, siteOrigin } from "@/lib/wa/seo";
import { isSponsored, listDocsForNews } from "@/lib/wa/feeds";

import { deliveryEnabled } from "@/lib/cms/runtime-config";

export const runtime = "nodejs";
export const maxDuration = 20;

/** llms.txt: a plain map of the site for AI assistants, with the newest stories. */
export async function GET(request: Request) {
  if (!deliveryEnabled()) return new Response("Not available on preview deployments.", { status: 503, headers: { "Cache-Control": "no-store" } });
  const origin = siteOrigin(request);
  const site = `${origin}${BASE}`;
  let recent: string[] = [];
  try {
    recent = (await listDocsForNews()).filter(d => !isSponsored(d)).slice(0, 25).map(d => `- [${d.title.replace(/[\[\]]/g, "")}](${site}/${encodeURIComponent(d.slug)})`);
  } catch { /* the map is still useful without the list */ }
  const body = [
    `# ${PUBLISHER}`,
    "",
    `> ${PUBLISHER} publishes whisky ratings and reviews on a 100-point scale, news about new releases and the industry, buying guides, cocktails, travel and the annual Top 20 Whiskies of the Year.`,
    "",
    "Every story and rating has its own page at /wa/<slug> with the full text in the HTML and schema.org markup (NewsArticle for stories, Product with Review for ratings). Paid content is labeled Sponsored and marked AdvertiserContentArticle.",
    "",
    "## Sections",
    `- [Ratings and reviews](${site}/finder.html): every rated whisky, searchable by score, style, price and producer`,
    `- [Stories](${site}/stories.html): news, features, guides, cocktails, travel and whisky life`,
    `- [Top 20 Whiskies of the Year](${site}/top20.html)`,
    `- [Guides and glossary](${site}/guides.html)`,
    `- [Cocktails](${site}/cocktails.html)`,
    `- [Producers](${site}/producers.html)`,
    "",
    "## Machine-readable",
    `- [RSS feed](${site}/feed.xml)`,
    `- [Sitemap](${site}/sitemap.xml)`,
    `- [Google News sitemap](${site}/news-sitemap.xml)`,
    "",
    "## Latest stories",
    ...recent,
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, s-maxage=3600" } });
}
