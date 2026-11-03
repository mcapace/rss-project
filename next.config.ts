import type { NextConfig } from "next";
import { readWaStaticNames } from "./src/lib/wa/static-names";
import { rootHosts } from "./src/lib/wa/site-host";

// The root URL shape (src/lib/wa/root-routing.ts): on these hosts the site is served at "/" and /wa/... 301s to the root
// form in the proxy, so the /wa redirects below must not fire there. Read at build time, like the proxy's file list.
const ROOT_HOSTS = rootHosts().map(host => host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
const ROOT_HOST_MATCH = [{ type: "host" as const, value: `(?:${ROOT_HOSTS})` }];

const nextConfig: NextConfig = {
  // public/wa's file and folder names for the proxy, which cannot read the disk per request (src/lib/wa/static-names.ts).
  env: { WA_STATIC_NAMES: JSON.stringify(readWaStaticNames()) },
  // /wa/<slug> renders the concept site's own story and bottle templates on the server (src/lib/wa/seo.ts).
  outputFileTracingIncludes: {
    "/wa/[slug]": ["./public/wa/*.html", "./public/wa/story.html", "./public/wa/bottle.html", "./public/wa/ratings.json", "./public/wa/stories*.json", "./public/wa/notes/*.json", "./public/wa/articles/*.json"],
    "/wa/recipes/[slug]": ["./public/wa/cocktail.html", "./public/wa/cocktails.json"],
    "/wa/producers/[name]": ["./public/wa/producer.html", "./public/wa/ratings.json"],
    // The takedown lists are cut from the public static files (src/lib/wa/live-stories.ts publicIndex).
    "/api/wa/latest": ["./public/wa/stories.json", "./public/wa/stories-archive.json", "./public/wa/ratings.json"],
    "/wa/whisky-bars/[slug]": ["./public/wa/whisky-bar.html", "./public/wa/whisky-bars.json"],
    "/wa/sitemap-pages.xml": ["./public/wa/whisky-bars.json"],
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
      { source: "/wa", destination: "/wa/index.html", permanent: false, missing: ROOT_HOST_MATCH },
      { source: "/wa/house-ads", destination: "/wa/house-ads/index.html", permanent: false, missing: ROOT_HOST_MATCH },
    ];
  },
};

export default nextConfig;
