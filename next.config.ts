import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // The Whisky Advocate concept site is static files under public/wa; the folder itself opens its home page.
    return [{ source: "/wa", destination: "/wa/index.html", permanent: false }];
  },
};

export default nextConfig;
