import { siteOrigin } from "@/lib/wa/seo";
import { XML } from "@/lib/wa/feeds";

export const runtime = "nodejs";

/** The sitemap index: stories (with their pictures), ratings, and the site's section pages. */
export function GET(request: Request) {
  const origin = siteOrigin(request);
  const today = new Date().toISOString().slice(0, 10);
  const maps = ["sitemap-stories.xml", "sitemap-ratings.xml", "sitemap-pages.xml", "news-sitemap.xml"];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${maps.map(m => `<sitemap><loc>${origin}/wa/${m}</loc><lastmod>${today}</lastmod></sitemap>`).join("\n")}\n</sitemapindex>\n`;
  return new Response(body, { headers: { ...XML, "Cache-Control": "public, s-maxage=3600" } });
}
