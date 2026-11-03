import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { connectedCmsEnabled, deliveryEnabled } from "@/lib/cms/runtime-config";
import { resolveRedirect } from "@/lib/cms/redirects-server";
import { decideRoot, parseWaStaticNames, rootRedirect, tagLocation, WA_PATH_HEADER } from "@/lib/wa/root-routing";
import { isRootHost, redirectLookupHost, rootOrigin, withSearch } from "@/lib/wa/site-host";

/** Paths the application itself serves; anything else is a candidate legacy URL for the redirect engine. */
const APP_PREFIXES = ["/cms", "/admin", "/reader", "/login", "/api", "/_next", "/brands-cms", "/share", "/wa"];
/** public/wa's file names, read at build time by next.config.ts (the proxy cannot read the disk per request). */
const WA_STATIC = parseWaStaticNames(process.env.WA_STATIC_NAMES);
type Lookup = { target: string | null; status: number; brand?: string };
const redirectCache = new Map<string, Lookup & { until: number }>();
/**
 * Ask the redirect engine about a legacy path, remembering answers briefly per instance, keyed by host and path (one
 * deployment serves several hosts, and their answers differ). The proxy runs on Node.js, so it reads the redirect map
 * directly: calling /api/redirects/resolve over HTTP from here failed (deployment protection on previews, and the
 * self-request did not complete in production), so every legacy URL fell through to 404.
 */
async function lookupRedirect(request: NextRequest): Promise<{ hit: Lookup | null; state: string }> {
  const path = request.nextUrl.pathname;
  // A staging host can answer with whiskyadvocate.com's rows (REDIRECT_HOST_ALIASES); the URL shape is WA_ROOT_HOSTS alone.
  const lookupHost = redirectLookupHost(request.nextUrl.hostname);
  const key = `${lookupHost}|${path}`;
  const cached = redirectCache.get(key);
  if (cached && cached.until > Date.now()) return { hit: cached.status === 404 ? null : cached, state: "cached" };
  if (!deliveryEnabled()) return { hit: null, state: "off" };
  try {
    const hit = await resolveRedirect(path, lookupHost);
    const data: Lookup = hit ? { target: hit.target, status: hit.status, brand: hit.brand } : { target: null, status: 404 };
    if (redirectCache.size > 5000) for (const [k, v] of redirectCache) if (v.until <= Date.now() || redirectCache.size > 4000) redirectCache.delete(k);
    redirectCache.set(key, { ...data, until: Date.now() + 300_000 });
    return { hit: data.status === 404 ? null : data, state: hit ? "hit" : "miss" };
  } catch (error) {
    console.error("[proxy redirects]", error instanceof Error ? error.message : error);
    return { hit: null, state: "error" };
  }
}

/** Today's catch-all matcher (before the root shape). On other hosts a path it did not match still skips the proxy's work. */
const LEGACY_MATCHER = /^\/(?!_next\/|api\/|cms|admin|reader|login|share|brands-cms\/|wa\/|favicon\.ico|robots\.txt|sitemap)/;
const LEGACY_EXPLICIT = /^\/(?:(?:cms|admin|reader)(?:\/.*)?|api\/feed|api\/cms(?:\/.*)?|api\/issues(?:\/.*)?|api\/process|api\/upload-url|api\/login|api\/logout|login)$/;

/**
 * The root URL shape (whiskyadvocate.com): the site is served at "/", old addresses stay as they are, and the app keeps
 * its own prefixes. Decided by decideRoot (src/lib/wa/root-routing.ts); returns null for the app's paths, which take the
 * session branch below unchanged.
 */
async function rootHost(request: NextRequest): Promise<NextResponse | null> {
  const { pathname, search } = request.nextUrl;
  const decision = decideRoot(pathname, search, WA_STATIC);
  // Passed-on site requests carry their path (WA_PATH_HEADER), so one that no file or route answers gets the site's 404.
  const site = () => {
    const headers = new Headers(request.headers);
    headers.set(WA_PATH_HEADER, pathname);
    return { request: { headers } };
  };
  switch (decision.type) {
    case "app": return null;
    case "next": return NextResponse.next(site());
    case "redirect": return NextResponse.redirect(new URL(decision.location, request.url), decision.status);
    case "rewrite": {
      const response = NextResponse.rewrite(new URL(decision.path, request.url), site());
      if (decision.noindex) response.headers.set("X-Robots-Tag", "noindex");
      if (decision.canonical) response.headers.set("Link", `<${rootOrigin()}${decision.canonical}>; rel="canonical"`);
      return response;
    }
    case "lookup": {
      if (process.env.REDIRECTS_AT_EDGE === "false") return NextResponse.next(site());
      const { hit, state } = await lookupRedirect(request);
      const answer = rootRedirect(hit, pathname);
      if (answer?.status === 410) return new NextResponse("This page has been retired.", { status: 410, headers: { "Cache-Control": "public, max-age=3600" } });
      if (answer?.target) {
        const target = answer.target.startsWith("/") ? new URL(withSearch(answer.target, search), request.url) : new URL(answer.target);
        return NextResponse.redirect(target, answer.status);
      }
      // No redirect: next(), so the app's other public files (/brands, /corporate) still serve; a real miss is the site's 404.
      const passed = NextResponse.next(site());
      passed.headers.set("x-legacy-redirect", hit ? "self" : state);
      return passed;
    }
  }
}

/**
 * Two jobs: answer legacy URLs with their permanent redirects at the edge, and
 * refresh sessions. Every private API/page performs its own verified authorization.
 */
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const root = isRootHost(request.headers.get("host") ?? request.nextUrl.host);
  if (root) {
    const answered = await rootHost(request);
    if (answered) return answered;
  } else {
    // Other hosts (the development host): exactly as before the root shape. The site under /wa is public files and
    // routes, and paths the old matcher skipped (sitemaps, /reader.js, robots.txt, favicon) still skip the proxy's work.
    if (pathname === "/wa" || pathname.startsWith("/wa/") || !(LEGACY_MATCHER.test(pathname) || LEGACY_EXPLICIT.test(pathname))) return NextResponse.next();
  }
  if (!root && pathname !== "/" && !APP_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`)) && process.env.REDIRECTS_AT_EDGE !== "false") {
    // The old site's tag pages (/tag/<name>, /Tag/<name>/) have no one-to-one page here: they open the story list filtered by that tag.
    const tag = /^\/tag\/([^/]+)\/?$/i.exec(pathname);
    if (tag) return NextResponse.redirect(new URL(tagLocation("/wa", tag[1]), request.url), 301);
    const { hit, state } = await lookupRedirect(request);
    if (hit?.status === 410) return new NextResponse("This page has been retired.", { status: 410, headers: { "Cache-Control": "public, max-age=3600" } });
    if (hit?.target) {
      const target = hit.target.startsWith("/") ? new URL(withSearch(hit.target, request.nextUrl.search), request.url) : new URL(hit.target);
      return NextResponse.redirect(target, [301, 302, 307, 308].includes(hit.status) ? hit.status : 301);
    }
    // What the redirect engine said about a path it did not redirect (off, miss, cached or error), for diagnosing legacy URLs.
    const passed = NextResponse.next();
    passed.headers.set("x-legacy-redirect", state || "none");
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
  // Everything else on a root host (whiskyadvocate.com and its subdomains, ROOT_HOST_PATTERN in site-host.ts; matcher
  // values must be constants): the root URL shape. Exclusions are whole segments, so /reader.js, /sitemap.xml and a slug
  // that merely starts with "cms" or "login" reach the proxy.
  { source: "/((?!_next/|api/|(?:cms|admin|reader|login|share|brands-cms)(?:/|$)).*)", has: [{ type: "host", value: "(?:[a-z0-9-]+\\.)*whiskyadvocate\\.com" }] },
  // Every other host: today's matcher, so the development host's /wa files, sitemaps, robots.txt and favicon never pay
  // for a proxy invocation; legacy URLs still reach the redirect engine.
  { source: "/((?!_next/|api/|cms|admin|reader|login|share|brands-cms/|wa/|favicon\\.ico|robots\\.txt|sitemap).*)", missing: [{ type: "host", value: "(?:[a-z0-9-]+\\.)*whiskyadvocate\\.com" }] },
] };
