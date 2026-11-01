import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /wa/<slug> renders the concept site's own story and bottle templates on the server (src/lib/wa/seo.ts).
  outputFileTracingIncludes: {
    "/wa/[slug]": ["./public/wa/story.html", "./public/wa/bottle.html"],
  },
  async redirects() {
    // The Whisky Advocate concept site is static files under public/wa; the folder itself opens its home page.
    return [{ source: "/wa", destination: "/wa/index.html", permanent: false }];
  },
};

export default nextConfig;
