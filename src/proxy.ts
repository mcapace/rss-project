import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { connectedCmsEnabled, deliveryEnabled } from "@/lib/cms/runtime-config";
import { resolveRedirect } from "@/lib/cms/redirects-server";

/** Paths the application itself serves; anything else is a candidate legacy URL for the redirect engine. */
const APP_PREFIXES = ["/cms", "/admin", "/reader", "/login", "/api", "/_next", "/brands-cms", "/share", "/wa"];
const redirectCache = new Map<string, { target: string | null; status: number; until: number }>();
/**
 * Staging hosts answered as the legacy domain, so old whiskyadvocate.com paths can be tested end to end before the
 * domain moves. REDIRECT_HOST_ALIASES ("staging.host=legacy.host,...") replaces the default; remove at launch.
 */
const HOST_ALIASES = new Map(
  (process.env.REDIRECT_HOST_ALIASES ?? "rss-project-ten.vercel.app=whiskyadvocate.com")
    .split(",").map(pair => pair.split("=").map(part => part.trim().toLowerCase())).filter(pair => pair.length === 2 && pair[0] && pair[1]) as [string, string][],
);

/**
 * Ask the redirect engine about a legacy path, remembering answers briefly per instance. The proxy runs on Node.js,
 * so it reads the redirect map directly: calling /api/redirects/resolve over HTTP from here failed (deployment
 * protection on previews, and the self-request did not complete in production), so every legacy URL fell through to 404.
 */
let lastLookup = "";
async function lookupRedirect(request: NextRequest): Promise<{ target: string | null; status: number } | null> {
  const path = request.nextUrl.pathname;
  const cached = redirectCache.get(path);
  if (cached && cached.until > Date.now()) { lastLookup = "cached"; return cached.status === 404 ? null : cached; }
  if (!deliveryEnabled()) { lastLookup = "off"; return null; }
  try {
    const host = request.nextUrl.hostname.toLowerCase();
    const hit = await resolveRedirect(path, HOST_ALIASES.get(host) ?? host);
    const data = hit ? { target: hit.target, status: hit.status } : { target: null, status: 404 };
    redirectCache.set(path, { ...data, until: Date.now() + 300_000 });
    lastLookup = hit ? "hit" : "miss";
    return data.status === 404 ? null : data;
  } catch (error) {
    lastLookup = "error";
    console.error("[proxy redirects]", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Two jobs: answer legacy URLs with their permanent redirects at the edge, and
 * refresh sessions. Every private API/page performs its own verified authorization.
 */
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname !== "/" && !APP_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`)) && process.env.REDIRECTS_AT_EDGE !== "false") {
    const hit = await lookupRedirect(request);
    if (hit?.status === 410) return new NextResponse("This page has been retired.", { status: 410, headers: { "Cache-Control": "public, max-age=3600" } });
    if (hit?.target) {
      const target = hit.target.startsWith("/") ? new URL(hit.target + request.nextUrl.search, request.url) : new URL(hit.target);
      return NextResponse.redirect(target, [301, 302, 307, 308].includes(hit.status) ? hit.status : 301);
    }
    // What the redirect engine said about a path it did not redirect (off, miss, cached or error), for diagnosing legacy URLs.
    const passed = NextResponse.next();
    passed.headers.set("x-legacy-redirect", lastLookup || "none");
    return passed;
  }
  let response = NextResponse.next({ request });
  if (!connectedCmsEnabled() || request.nextUrl.pathname.startsWith("/cms/demo")) return response;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;
  const client = createServerClient(url, key, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies, headers) => {
        for (const { name, value } of cookies) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookies) response.cookies.set(name, value, options);
        for (const [name, value] of Object.entries(headers || {})) response.headers.set(name, value);
      },
    },
  });
  await client.auth.getClaims();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = { matcher: [
  "/cms/:path*", "/admin/:path*", "/reader/:path*", "/api/feed", "/api/cms/:path*", "/api/issues/:path*", "/api/process", "/api/upload-url", "/api/login", "/api/logout", "/login",
  // Legacy URLs: everything the application does not serve itself goes to the redirect engine.
  "/((?!_next/|api/|cms|admin|reader|login|share|brands-cms/|wa/|favicon\\.ico|robots\\.txt|sitemap).*)",
] };
