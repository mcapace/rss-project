import { robotsTxt } from "@/lib/wa/robots";
import { siteFor } from "@/lib/wa/site-host";

export const runtime = "nodejs";

/** robots.txt, per host (src/lib/wa/robots.ts). */
export function GET(request: Request) {
  return new Response(robotsTxt(siteFor(request)), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, s-maxage=3600" } });
}
