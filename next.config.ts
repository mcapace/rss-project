import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /wa/<slug> renders the concept site's own story and bottle templates on the server (src/lib/wa/seo.ts).
  outputFileTracingIncludes: {
    "/wa/[slug]": ["./public/wa/story.html", "./public/wa/bottle.html", "./public/wa/ratings.json", "./public/wa/stories*.json", "./public/wa/notes/*.json", "./public/wa/articles/*.json"],
    "/wa/recipes/[slug]": ["./public/wa/cocktail.html", "./public/wa/cocktails.json"],
    "/wa/producers/[name]": ["./public/wa/producer.html", "./public/wa/ratings.json"],
  },
  // The development hosts (*.vercel.app) stay out of search results, so they never compete with whiskyadvocate.com.
  // A custom production domain does not match, so pages there are indexable as soon as the domain points here.
  async headers() {
    return [{ source: "/:path*", has: [{ type: "host", value: "(?<host>.*)\\.vercel\\.app" }], headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
  },
  async redirects() {
    // The Whisky Advocate concept site is static files under public/wa; the folder itself opens its home page.
    // /wa/house-ads would otherwise reach the /wa/[slug] story route.
    return [
      { source: "/wa", destination: "/wa/index.html", permanent: false },
      { source: "/wa/house-ads", destination: "/wa/house-ads/index.html", permanent: false },
    ];
  },
};

export default nextConfig;
