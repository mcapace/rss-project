import "server-only";
import { lookup } from "node:dns/promises";
import { request as requestHttps } from "node:https";
import { BlockList, isIP } from "node:net";
import Parser from "rss-parser";
import { CmsError } from "./cms/access";
import { sanitizeCmsHtml } from "./cms/html";

export const MAX_RSS_BYTES = 8 * 1024 * 1024;
export const RSS_TIMEOUT_MS = 10_000;

type FeedTarget = { kind: "internal"; url: URL; brand: string; issueId: string } | { kind: "external"; url: URL };

/** User input never becomes a generic server-side URL fetch. */
export function legacyFeedTarget(raw: string | null, origin: string): FeedTarget {
  if (!raw || raw.length > 4096) throw new CmsError(400, "Enter a valid legacy feed URL.");
  const input = raw.trim();
  if (input.includes("\\") || /[\u0000-\u001f\u007f]/.test(input)) throw new CmsError(400, "Enter a valid legacy feed URL.");
  let url: URL;
  try { url = new URL(input, origin); }
  catch { throw new CmsError(400, "Enter a valid legacy feed URL."); }
  if (url.username || url.password || url.hash) throw new CmsError(400, "Feed URLs cannot contain credentials or a fragment.");

  if (url.origin === origin) {
    const match = /^\/api\/feeds\/(wa|ws|ca|mw)\/([A-Za-z0-9][A-Za-z0-9_-]{0,99})\/feed\.xml$/.exec(url.pathname);
    if (!match || url.search) throw new CmsError(400, "Choose an exact published issue feed URL.");
    return { kind: "internal", url, brand: match[1], issueId: match[2] };
  }

  const host = url.hostname.toLowerCase();
  const allowed = new Set((process.env.LEGACY_RSS_HOSTS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
  if (!input.startsWith("https://") || url.protocol !== "https:" || url.port || host.endsWith(".") ||
      isIP(host) || host.startsWith("[") || host === "localhost" || /\.(?:localhost|local|internal|lan)$/.test(host) || !allowed.has(host)) {
    throw new CmsError(403, "This external feed host has not been enabled for the legacy reader.");
  }
  return { kind: "external", url };
}

const blockedV4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedV4.addSubnet(network, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const blockedV6 = new BlockList();
blockedV6.addSubnet("2001::", 23, "ipv6");
blockedV6.addSubnet("2001:db8::", 32, "ipv6");
blockedV6.addSubnet("2002::", 16, "ipv6");

function publicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, "ipv4");
  return family === 6 && globalV6.check(address, "ipv6") && !blockedV6.check(address, "ipv6");
}

/** Bounded, uncompressed HTTPS request with a validated connection lookup. No redirect following. */
export function readExternalRss(url: URL): Promise<string> {
  return new Promise((resolve, reject) => {
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error, text?: string) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error instanceof CmsError ? error : new CmsError(502, "The external feed could not be read."));
      else resolve(text || "");
    };
    const request = requestHttps(url, {
      method: "GET",
      agent: false,
      headers: { "User-Agent": "MShanken-Legacy-Reader/1.0", Accept: "application/rss+xml, application/xml, text/xml", "Accept-Encoding": "identity" },
      lookup(hostname, options, callback) {
        // Validate the addresses returned to this connection, rather than checking
        // DNS separately and letting the HTTP client resolve a second time.
        lookup(hostname, { all: true, verbatim: true }).then(addresses => {
          if (!addresses.length || addresses.some(item => !publicAddress(item.address))) {
            callback(new CmsError(403, "This feed host does not resolve to a public address."), "");
            return;
          }
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        }).catch(error => callback(error instanceof Error ? error : new Error("DNS lookup failed"), ""));
      },
    }, response => {
      response.once("error", error => finish(error));
      response.once("aborted", () => finish(new CmsError(502, "The external feed response was interrupted.")));
      const rejectResponse = (error: CmsError) => {
        finish(error);
        response.destroy();
        request.destroy();
      };
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
        rejectResponse(new CmsError(422, "The feed redirected. Enter its final HTTPS URL and enable that exact host."));
        return;
      }
      if (response.statusCode !== 200) { rejectResponse(new CmsError(502, "The external feed returned an unsuccessful response.")); return; }
      const encoding = response.headers["content-encoding"];
      if (encoding && encoding !== "identity") { rejectResponse(new CmsError(422, "The legacy reader requires an uncompressed XML response.")); return; }
      const declaredLength = Number(response.headers["content-length"]);
      if (declaredLength > MAX_RSS_BYTES) { rejectResponse(new CmsError(413, "The legacy feed exceeds the 8 MB limit.")); return; }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        if (finished) return;
        bytes += chunk.byteLength;
        if (bytes > MAX_RSS_BYTES) { rejectResponse(new CmsError(413, "The legacy feed exceeds the 8 MB limit.")); return; }
        chunks.push(chunk);
      });
      response.once("end", () => finish(undefined, Buffer.concat(chunks).toString("utf8")));
    });
    request.once("error", error => finish(error));
    timer = setTimeout(() => {
      finish(new CmsError(504, "The external feed did not respond within 10 seconds."));
      request.destroy();
    }, RSS_TIMEOUT_MS);
    timer.unref();
    request.end();
  });
}

type RawItem = { author?: unknown; description?: unknown; contentEncoded?: unknown; mediaContent?: unknown; "content:encoded"?: unknown };
const parser = new Parser<Record<string, unknown>, RawItem>({
  customFields: { item: [["media:content", "mediaContent", { keepArray: true }], ["content:encoded", "contentEncoded"], ["description", "description"]] },
});

function text(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function html(value: unknown): string | undefined { return typeof value === "string" ? sanitizeCmsHtml(value) : undefined; }
function link(value: unknown, base: URL): string | undefined {
  if (typeof value !== "string" || value.length > 8192) return undefined;
  try {
    const url = new URL(value, base);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}
function object(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }

export async function parseLegacyRss(xml: string, base: URL) {
  if (Buffer.byteLength(xml, "utf8") > MAX_RSS_BYTES) throw new CmsError(413, "The legacy feed exceeds the 8 MB limit.");
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new CmsError(422, "XML document types and entity declarations are not supported.");
  let feed;
  try { feed = await parser.parseString(xml); }
  catch { throw new CmsError(422, "The response is not a supported RSS feed."); }
  if (feed.items.length > 1000) throw new CmsError(413, "This legacy feed contains too many items for the reader.");
  return {
    title: text(feed.title), description: html(feed.description), link: link(feed.link, base), feedUrl: link(feed.feedUrl, base),
    items: feed.items.map(item => {
      const rawMedia = Array.isArray(item.mediaContent) ? item.mediaContent : item.mediaContent ? [item.mediaContent] : [];
      const mediaContent = rawMedia.slice(0, 100).flatMap(raw => {
        const media = object(raw);
        const attributes = object(media?.$) || media;
        const url = link(attributes?.url, base);
        return url ? [{ $: { url, type: text(attributes?.type), width: text(attributes?.width), height: text(attributes?.height), medium: text(attributes?.medium) } }] : [];
      });
      const enclosureUrl = link(item.enclosure?.url, base);
      return {
        title: text(item.title), link: link(item.link, base), guid: text(item.guid), pubDate: text(item.pubDate), isoDate: text(item.isoDate),
        creator: text(item.creator), author: text(item.author), contentSnippet: text(item.contentSnippet),
        categories: Array.isArray(item.categories) ? item.categories.filter(value => typeof value === "string") : [],
        description: html(item.description), contentEncoded: html(item.contentEncoded), content: html(item.content), summary: html(item.summary),
        "content:encoded": html(item["content:encoded"]), mediaContent,
        enclosure: enclosureUrl ? { url: enclosureUrl, type: text(item.enclosure?.type), length: item.enclosure?.length } : undefined,
      };
    }),
  };
}
