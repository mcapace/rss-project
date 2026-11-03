import { NextResponse } from "next/server";
import { resolveRedirect } from "@/lib/cms/redirects-server";
import { deliveryEnabled } from "@/lib/cms/runtime-config";
import { rootRedirect } from "@/lib/wa/root-routing";
import { isRootHost, redirectLookupHost } from "@/lib/wa/site-host";

export const runtime = "nodejs";

/**
 * Answers the edge: does this legacy path redirect, and where? Public and
 * cacheable, because a redirect map is not a secret and the edge calls it
 * for every miss. The rows are those of `host` (through REDIRECT_HOST_ALIASES, like the proxy). When this request is
 * itself served on a root host (whiskyadvocate.com points here), the answer is what the proxy does there: Whisky
 * Advocate rows only, the target in its root form, and a target that is the path itself is no redirect. Elsewhere (the
 * development host, and so before the cutover) the rows are returned as stored.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const path = (url.searchParams.get("path") ?? "").slice(0, 2048);
  const host = (url.searchParams.get("host") ?? "").slice(0, 253) || null;
  if (!path.startsWith("/")) return NextResponse.json({ error: "path is required" }, { status: 422 });
  if (!deliveryEnabled()) return NextResponse.json({ target: null, status: 404, unavailable: true }, { headers: { "Cache-Control": "no-store" } });
  try {
    const raw = await resolveRedirect(path, host ? redirectLookupHost(host) : null);
    const mapped = isRootHost(request.headers.get("host") || url.host) ? rootRedirect(raw, path) : raw;
    const hit = mapped && raw ? { target: mapped.target, status: mapped.status, brand: raw.brand } : null;
    return NextResponse.json(hit ? { target: hit.target, status: hit.status, brand: hit.brand } : { target: null, status: 404 }, {
      headers: { "Cache-Control": hit ? "public, s-maxage=300, stale-while-revalidate=3600" : "public, s-maxage=60, stale-while-revalidate=600" },
    });
  } catch {
    return NextResponse.json({ target: null, status: 404, unavailable: true }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
