import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /wa/<slug> renders the concept site's own story and bottle templates on the server (src/lib/wa/seo.ts).
  outputFileTracingIncludes: {
    "/wa/[slug]": ["./public/wa/story.html", "./public/wa/bottle.html", "./public/wa/ratings.json", "./public/wa/stories*.json", "./public/wa/notes/*.json", "./public/wa/articles/*.json"],
    "/wa/recipes/[slug]": ["./public/wa/cocktail.html", "./public/wa/cocktails.json"],
    "/wa/producers/[name]": ["./public/wa/producer.html", "./public/wa/ratings.json"],
  },
  async redirects() {
    // The Whisky Advocate concept site is static files under public/wa; the folder itself opens its home page.
    return [{ source: "/wa", destination: "/wa/index.html", permanent: false }];
  },
};

export default nextConfig;
