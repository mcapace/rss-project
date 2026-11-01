import { siteOrigin } from "@/lib/wa/seo";

export const runtime = "nodejs";

/**
 * robots.txt. Search engines and the AI answer engines that cite and link their sources may read the site;
 * crawlers that only collect training data are kept out (the old site blocked GPTBot and CCBot too). Google's AI
 * Overviews read through Googlebot, which is allowed; Google-Extended only governs Gemini training.
 */
const ANSWER_ENGINES = ["Googlebot", "Googlebot-News", "Googlebot-Image", "Bingbot", "OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Perplexity-User", "Claude-SearchBot", "Claude-User", "Applebot", "DuckDuckBot"];
const TRAINING_ONLY = ["GPTBot", "CCBot", "Google-Extended", "Applebot-Extended", "ClaudeBot", "anthropic-ai", "Bytespider", "meta-externalagent", "cohere-ai"];
const PRIVATE = ["/cms", "/admin", "/api/", "/login", "/reader", "/share/", "/brands-cms"];

export function GET(request: Request) {
  const origin = siteOrigin(request);
  const lines = [
    "# Whisky Advocate",
    "User-agent: *",
    "Allow: /",
    ...PRIVATE.map(p => `Disallow: ${p}`),
    "",
    ...ANSWER_ENGINES.flatMap(ua => [`User-agent: ${ua}`, "Allow: /", ...PRIVATE.map(p => `Disallow: ${p}`), ""]),
    "# Training-only crawlers",
    ...TRAINING_ONLY.flatMap(ua => [`User-agent: ${ua}`, "Disallow: /", ""]),
    `Sitemap: ${origin}/wa/sitemap.xml`,
    `Sitemap: ${origin}/wa/news-sitemap.xml`,
  ];
  return new Response(lines.join("\n") + "\n", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, s-maxage=3600" } });
}
