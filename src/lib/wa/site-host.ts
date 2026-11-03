/**
 * Which shape of the Whisky Advocate site a request gets (2026-11-03, the root URL shape).
 *
 * One deployment serves two kinds of host. A ROOT host (whiskyadvocate.com and www., or whatever WA_ROOT_HOSTS lists)
 * serves the site at the root, so every old address (whiskyadvocate.com/<Slug>) stays exactly that address. Every other
 * host (the development host rss-project-ten.vercel.app, previews, localhost) keeps the site under /wa as before. The
 * choice is made per request host, never per environment. No "server-only": the proxy imports this too.
 */

export type WaSite = { root: boolean; origin: string; base: "" | "/wa" };

const DEFAULT_ROOT_HOSTS = "whiskyadvocate.com,www.whiskyadvocate.com";
export const DEFAULT_ROOT_ORIGIN = "https://whiskyadvocate.com";

/** A host as compared here: lowercase, no port, no trailing dot. */
export function cleanHost(host: string | null | undefined): string {
  return String(host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

/**
 * A root host must be whiskyadvocate.com or one of its subdomains (a staging rehearsal uses staging.whiskyadvocate.com):
 * the proxy's matcher (src/proxy.ts) only runs the root rules on such hosts, because matcher values are build-time
 * constants, and the static pages (public/wa/site.js) only take the root link shape there. Any other host in
 * WA_ROOT_HOSTS is ignored, so it keeps the development shape (/wa), which works everywhere.
 */
export const ROOT_HOST_PATTERN = /^(?:[a-z0-9-]+\.)*whiskyadvocate\.com$/;

/** The root hosts: WA_ROOT_HOSTS (a comma list, whiskyadvocate.com and its subdomains only), else the apex and www. */
export function rootHosts(env: string | undefined = process.env.WA_ROOT_HOSTS): string[] {
  const list = (env ?? DEFAULT_ROOT_HOSTS).split(",").map(cleanHost).filter(host => ROOT_HOST_PATTERN.test(host));
  return list.length ? [...new Set(list)] : DEFAULT_ROOT_HOSTS.split(",");
}

export function isRootHost(host: string | null | undefined): boolean {
  const h = cleanHost(host);
  return !!h && rootHosts().includes(h);
}

/**
 * The host whose redirect rows answer for a request host. REDIRECT_HOST_ALIASES ("staging.host=legacy.host,...") lets a
 * staging host answer with whiskyadvocate.com's rows, so old addresses can be rehearsed before the domain moves; unset,
 * every host answers as itself. One place for the proxy, the story route's misses and /api/redirects/resolve.
 */
export function redirectLookupHost(host: string | null | undefined, env: string | undefined = process.env.REDIRECT_HOST_ALIASES): string {
  const h = cleanHost(host);
  for (const pair of (env ?? "").split(",")) {
    const [from, to] = pair.split("=").map(part => cleanHost(part));
    if (from && to && from === h) return to;
  }
  return h;
}

/**
 * A redirect target with the request's query string added: before the target's fragment (so /top20.html#2019 plus
 * ?utm_source=nl is /top20.html?utm_source=nl#2019), and after any query the target already has.
 */
export function withSearch(target: string, search: string): string {
  const query = search.replace(/^\?/, "");
  if (!query) return target;
  const hashAt = target.indexOf("#");
  const before = hashAt < 0 ? target : target.slice(0, hashAt);
  const hash = hashAt < 0 ? "" : target.slice(hashAt);
  return `${before}${before.includes("?") ? "&" : "?"}${query}${hash}`;
}

/**
 * Whether whiskyadvocate.com already points at this app (WA_ROOT_LIVE=1, set at DNS cutover). Until then the domain is
 * still the old site, so anything sent outside the app (newsletter links) keeps using the development host's /wa URLs.
 */
export function waRootLive(): boolean {
  return /^(1|true|yes)$/i.test(process.env.WA_ROOT_LIVE?.trim() ?? "");
}

/** The canonical origin of the root shape: WA_SITE_ORIGIN when set (it applies to root hosts only), else the apex. */
export function rootOrigin(): string {
  return process.env.WA_SITE_ORIGIN?.trim().replace(/\/+$/, "") || DEFAULT_ROOT_ORIGIN;
}

function hostOf(request: Request): string {
  return request.headers.get("host") || new URL(request.url).host;
}

/**
 * The site for a request (or a bare host): on a root host the canonical origin with no prefix, elsewhere the request's
 * own origin with /wa. A route reached through the proxy's rewrite still sees the original Host, so this is right there too.
 */
export function siteFor(input: Request | string): WaSite {
  const host = typeof input === "string" ? input : hostOf(input);
  if (isRootHost(host)) return { root: true, origin: rootOrigin(), base: "" };
  const origin = typeof input === "string" ? `https://${cleanHost(host)}` : new URL(input.url).origin;
  return { root: false, origin, base: "/wa" };
}

/**
 * The root form of a site path: "/wa", "/wa/" and "/wa/index.html" are the home page "/", "/wa/<rest>" is "/<rest>",
 * anything else (including absolute URLs) is unchanged.
 */
export function rootPath(path: string): string {
  if (!path.startsWith("/")) return path;
  const cut = path.search(/[?#]/);
  const pathname = cut < 0 ? path : path.slice(0, cut);
  const rest = cut < 0 ? "" : path.slice(cut);
  if (pathname === "/wa" || pathname === "/wa/" || pathname === "/wa/index.html") return "/" + rest;
  if (pathname.startsWith("/wa/")) return pathname.slice(3) + rest;
  return path;
}

/** A "Served by a site page" value (metadata.page_file): a top-level public/wa page's file name, such as water.html. */
export const PAGE_FILE_PATTERN = /^[a-z0-9][a-z0-9-]*\.html$/;

/** A link on the site: the site's base plus a path that starts with "/". */
export function sitePath(site: Pick<WaSite, "base">, path: string): string {
  return site.base + path;
}

/** Two paths name the same page: decoded, case-insensitive, trailing slash ignored, query and fragment ignored. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    let out = p.split(/[?#]/)[0];
    try { out = decodeURIComponent(out); } catch { /* keep as given */ }
    out = out.replace(/\/{2,}/g, "/");
    if (out.length > 1) out = out.replace(/\/+$/, "");
    return out.toLowerCase();
  };
  return norm(a) === norm(b);
}
