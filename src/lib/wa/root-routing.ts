import { isRootHost, rootPath, samePath } from "./site-host";

/**
 * The proxy's routing decision on a root host (whiskyadvocate.com), as a pure function so every case is unit tested
 * (src/lib/wa/root-shape.test.ts and src/lib/wa/root-proxy.test.ts). The proxy (src/proxy.ts) carries it out. None of these rules touch the
 * database except "lookup", and they run outside the redirect kill switch: a database outage or REDIRECTS_AT_EDGE=false
 * must never 404 the site.
 */

export type WaStaticNames = { top: string[]; shared: Record<string, string[]> };

export type RootDecision =
  | { type: "rewrite"; path: string; noindex?: boolean; canonical?: string }
  | { type: "redirect"; location: string; status: number }
  | { type: "app" }
  | { type: "next" }
  | { type: "lookup" };

/**
 * The request header the proxy adds on a root host to every site request it passes on (not the app's paths), carrying
 * the path as received. The app's not-found page (src/app/not-found.tsx) reads it, so a site address that nothing
 * answers shows the Whisky Advocate 404, not the editorial workspace's. A client could send it on an app path too; all it
 * changes there is which 404 page that client sees, and only on a root host.
 */
export const WA_PATH_HEADER = "x-wa-site-path";

/** The application's own prefixes, matched by whole segment (so /reader.js is a site file, not the /reader app). */
export const APP_PREFIXES = ["/cms", "/admin", "/api", "/_next", "/login", "/reader", "/share", "/brands-cms"];

/** The four bare templates read their item from the URL hash; on their own they are empty pages, kept out of search. */
export const BARE_TEMPLATES = new Set(["story.html", "bottle.html", "cocktail.html", "producer.html"]);

export function isAppPath(pathname: string): boolean {
  return APP_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(prefix + "/"));
}

/** The lists as next.config.ts hands them to the proxy (a JSON string inlined as process.env.WA_STATIC_NAMES). */
export function parseWaStaticNames(value: string | undefined): WaStaticNames {
  try {
    const parsed = JSON.parse(value || "") as Partial<WaStaticNames>;
    const top = Array.isArray(parsed.top) ? parsed.top.filter((n): n is string => typeof n === "string") : [];
    const shared: Record<string, string[]> = {};
    for (const [dir, files] of Object.entries(parsed.shared && typeof parsed.shared === "object" ? parsed.shared : {})) {
      if (Array.isArray(files)) shared[dir] = files.filter((n): n is string => typeof n === "string");
    }
    return { top, shared };
  } catch {
    return { top: [], shared: {} };
  }
}

function decoded(segment: string): string {
  try { return decodeURIComponent(segment); } catch { return segment; }
}

/**
 * What a root host does with a request path (pathname as received, percent-encoded; search with its "?").
 *  1. /wa and /wa/... : 301 to the root form (the old /wa address of anything).
 *  2. / : the home page (public/wa/index.html).
 *  3. App prefixes : the app (the proxy's session branch, unchanged).
 *  4. robots.txt, llms.txt : the app routes, which answer per host.
 *  5. A public/wa name : that file (no database). A folder that also exists in public/ (fonts) only for its WA files;
 *     the others are the CMS's public files. The bare templates are served noindex.
 *  6. /favicon.ico is the site's (a public/wa name, so rule 5).
 *  7. /tag/<name> : 301 to the story list filtered by that tag.
 *  8. One segment : /wa/<segment>, where the story route (or a sitemap or feed route) answers.
 *  9. /recipes/<x>, /producers/<x> : their /wa routes.
 * 10. Anything else : the redirect engine ("lookup").
 */
export function decideRoot(pathname: string, search: string, names: WaStaticNames): RootDecision {
  if (pathname === "/wa" || pathname.startsWith("/wa/")) return { type: "redirect", location: rootPath(pathname) + search, status: 301 };
  if (pathname === "/") return { type: "rewrite", path: "/wa/index.html" + search };
  if (isAppPath(pathname)) return { type: "app" };
  if (pathname === "/robots.txt" || pathname === "/llms.txt") return { type: "next" };

  const segments = pathname.slice(1).split("/");
  const first = decoded(segments[0]);
  if (names.top.includes(first)) {
    const shared = names.shared[first];
    if (shared && segments.length > 1) {
      // A folder both sites have: the site's files go to public/wa, the rest stay the app's own public files.
      return segments.length === 2 && shared.includes(decoded(segments[1])) ? { type: "rewrite", path: "/wa" + pathname + search } : { type: "next" };
    }
    // A folder's bare name opens its index page, as /wa/house-ads does on the development host.
    if (segments.length === 1 && first === "house-ads") return { type: "redirect", location: "/house-ads/index.html" + search, status: 307 };
    // /index.html is the home page under a second address (every page's logo links to it): served, with "/" as canonical.
    if (segments.length === 1 && first === "index.html") return { type: "rewrite", path: "/wa/index.html" + search, canonical: "/" };
    return { type: "rewrite", path: "/wa" + pathname + search, ...(segments.length === 1 && BARE_TEMPLATES.has(first) ? { noindex: true } : {}) };
  }

  const tag = /^\/tag\/([^/]+)\/?$/i.exec(pathname);
  if (tag) return { type: "redirect", location: tagLocation("", tag[1]), status: 301 };

  if (segments.length === 1 && segments[0]) return { type: "rewrite", path: "/wa" + pathname + search };
  if (segments.length === 2 && /^(recipes|producers)$/.test(segments[0]) && segments[1]) return { type: "rewrite", path: "/wa" + pathname + search };
  return { type: "lookup" };
}

/** The old site's tag pages (/tag/<name>) open the story list filtered by that tag. */
export function tagLocation(base: "" | "/wa", rawName: string): string {
  const name = decoded(rawName);
  return `${base}/stories.html#tag=${encodeURIComponent(name.replace(/-/g, " ").trim())}`;
}

/**
 * A redirect engine answer as a root host uses it: only Whisky Advocate rows, the target in its root form, and a target
 * that is the request's own path (case-insensitive, trailing slash ignored) is no redirect at all (the import rows for
 * every story's own old path would otherwise loop).
 */
export function rootRedirect(hit: { target: string | null; status: number; brand?: string } | null, requestPath: string): { target: string | null; status: number } | null {
  if (!hit || (hit.brand && hit.brand !== "wa")) return null;
  if (hit.status === 410) return { target: null, status: 410 };
  if (!hit.target) return null;
  let target = hit.target;
  // An absolute target on a root host is a site path: reduced to it, it gets the same root form and self-target check
  // (https://whiskyadvocate.com/a/b for /a/b would otherwise loop, and https://www.whiskyadvocate.com/wa/x hop via /wa).
  if (/^https?:\/\//i.test(target)) {
    try { const url = new URL(target); if (isRootHost(url.host)) target = (url.pathname || "/") + url.search + url.hash; } catch { /* keep as given */ }
  }
  target = rootPath(target);
  if (target.startsWith("/") && samePath(target, requestPath)) return null;
  return { target, status: [301, 302, 307, 308].includes(hit.status) ? hit.status : 301 };
}
