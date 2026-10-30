import { NextResponse } from "next/server";
import { resolveRedirect } from "@/lib/cms/redirects-server";

export const runtime = "nodejs";

/**
 * Answers the edge: does this legacy path redirect, and where? Public and
 * cacheable, because a redirect map is not a secret and the edge calls it
 * for every miss.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const path = (url.searchParams.get("path") ?? "").slice(0, 2048);
  const host = (url.searchParams.get("host") ?? "").slice(0, 253) || null;
  if (!path.startsWith("/")) return NextResponse.json({ error: "path is required" }, { status: 422 });
  try {
    const hit = await resolveRedirect(path, host);
    return NextResponse.json(hit ? { target: hit.target, status: hit.status, brand: hit.brand } : { target: null, status: 404 }, {
      headers: { "Cache-Control": hit ? "public, s-maxage=300, stale-while-revalidate=3600" : "public, s-maxage=60, stale-while-revalidate=600" },
    });
  } catch {
    return NextResponse.json({ target: null, status: 404, unavailable: true }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
