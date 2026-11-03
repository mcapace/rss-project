import type { WaSite } from "./site-host";

/**
 * robots.txt. Search engines and the AI answer engines that cite and link their sources may read the site;
 * crawlers that only collect training data are kept out (the old site blocked GPTBot and CCBot too). Google's AI
 * Overviews read through Googlebot, which is allowed; Google-Extended only governs Gemini training.
 *
 * On whiskyadvocate.com (a root host) the site's own files sit at the root beside the app, so the app's paths are
 * closed by whole segment (Disallow: /reader blocks /reader.js too, which every page loads), and the published images
 * and the site's read-only data under /api stay crawlable. Other hosts keep the rules they had.
 */
const ANSWER_ENGINES = ["Googlebot", "Googlebot-News", "Googlebot-Image", "Bingbot", "OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Perplexity-User", "Claude-SearchBot", "Claude-User", "Applebot", "DuckDuckBot"];
const TRAINING_ONLY = ["GPTBot", "CCBot", "Google-Extended", "Applebot-Extended", "ClaudeBot", "anthropic-ai", "Bytespider", "meta-externalagent", "cohere-ai"];
const PRIVATE = ["/cms", "/admin", "/api/", "/login", "/reader", "/share/", "/brands-cms"];
const APP_SEGMENTS = ["/cms", "/admin", "/login", "/brands-cms", "/reader", "/share"];

function rules(site: WaSite): string[] {
  if (!site.root) return ["Allow: /", ...PRIVATE.map(p => `Disallow: ${p}`)];
  return [
    "Allow: /",
    ...APP_SEGMENTS.flatMap(p => [`Disallow: ${p}/`, `Disallow: ${p}$`]),
    "Allow: /api/media/",
    "Allow: /api/wa/",
    "Disallow: /api/",
  ];
}

export function robotsTxt(site: WaSite): string {
  const lines = [
    "# Whisky Advocate",
    "User-agent: *",
    ...rules(site),
    "",
    ...ANSWER_ENGINES.flatMap(ua => [`User-agent: ${ua}`, ...rules(site), ""]),
    "# Training-only crawlers",
    ...TRAINING_ONLY.flatMap(ua => [`User-agent: ${ua}`, "Disallow: /", ""]),
    `Sitemap: ${site.origin}${site.base}/sitemap.xml`,
    `Sitemap: ${site.origin}${site.base}/news-sitemap.xml`,
  ];
  return lines.join("\n") + "\n";
}
