import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { LookupFunction } from "node:net";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireCmsUser: vi.fn(), getIssueFeedXml: vi.fn(), request: vi.fn(), lookup: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../auth-server", () => ({ requireCmsUser: mocks.requireCmsUser }));
vi.mock("@/lib/feed-builder", () => ({ getIssueFeedXml: mocks.getIssueFeedXml }));
vi.mock("node:https", () => ({ request: mocks.request }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));

import { GET } from "@/app/api/feed/route";
import { MAX_RSS_BYTES, RSS_TIMEOUT_MS } from "@/lib/legacy-rss";
import { CmsError } from "../access";

const feed = `<?xml version="1.0"?><rss version="2.0"><channel><title>Sample issue</title><link>https://publication.example.test/</link><description>Synthetic fixture</description><item><title>Sample article</title><description><![CDATA[<p>Readable body.</p>]]></description></item></channel></rss>`;
let responseStatus: number;
let responseHeaders: Record<string, string>;
let responseBody: string | Buffer;
let stallResponse: boolean;
let connections: Array<EventEmitter & { destroy: ReturnType<typeof vi.fn> }>;

function request(target?: string, headers?: Record<string, string>) {
  return new Request(`https://cms.example/api/feed${target === undefined ? "" : `?url=${encodeURIComponent(target)}`}`, { headers });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("LEGACY_RSS_HOSTS", "feeds.example.test");
  mocks.requireCmsUser.mockResolvedValue({ id: "editor", email: "editor@example.test", role: "editor", brands: ["wa"] });
  mocks.getIssueFeedXml.mockResolvedValue(feed);
  mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  responseStatus = 200;
  responseHeaders = {};
  responseBody = feed;
  stallResponse = false;
  connections = [];
  mocks.request.mockImplementation((url: URL, options: { lookup: LookupFunction }, callback: (response: IncomingMessage) => void) => {
    const emitter = new EventEmitter();
    const connection = Object.assign(emitter, {
      destroy: vi.fn((error?: Error) => { if (error) queueMicrotask(() => emitter.emit("error", error)); return emitter; }),
      end: vi.fn(() => {
        options.lookup(url.hostname, { all: true }, (error) => {
          if (error) { emitter.emit("error", error); return; }
          if (stallResponse) return;
          const response = Object.assign(new PassThrough(), { statusCode: responseStatus, headers: responseHeaders });
          callback(response as unknown as IncomingMessage);
          if (!response.destroyed) response.end(responseBody);
        });
      }),
    });
    connections.push(connection);
    return connection;
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("Legacy feed authorization and URL scope", () => {
  it("requires a verified CMS user before URL parsing, database work or network requests", async () => {
    mocks.requireCmsUser.mockRejectedValue(new CmsError(401, "Sign in", "sign_in_required"));
    const result = await GET(request());
    expect(result.status).toBe(401);
    expect(mocks.getIssueFeedXml).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it("authorizes the publication before reading an exact internal issue path", async () => {
    const result = await GET(request("/api/feeds/ws/test-issue/feed.xml"));
    expect(result.status).toBe(403);
    expect(mocks.getIssueFeedXml).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("reads an authorized internal issue without fetching it over the network or trusting forwarded host headers", async () => {
    const result = await GET(request("https://cms.example/api/feeds/wa/test-issue/feed.xml", { "x-forwarded-host": "untrusted.example", "x-forwarded-proto": "http" }));
    expect(result.status).toBe(200);
    expect(mocks.getIssueFeedXml).toHaveBeenCalledWith("wa", "test-issue", "https://cms.example");
    expect(mocks.request).not.toHaveBeenCalled();
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(result.headers.get("Vary")).toBe("Cookie");
  });

  it.each([
    ["/prefix/api/feeds/wa/test-issue/feed.xml", 400],
    ["/api/feeds/wa/test-issue/feed.xml/extra", 400],
    ["/api/feeds/wa/test-issue/feed.xml?extra=1", 400],
    ["https://unapproved.example/api/feeds/wa/test-issue/feed.xml", 403],
    ["https://feeds.example.test.evil.example/feed.xml", 403],
    ["https://feeds.example.test:8443/feed.xml", 403],
    ["http://feeds.example.test/feed.xml", 403],
    ["//feeds.example.test/feed.xml", 403],
    ["file:///etc/passwd", 403],
    ["https://name:password@feeds.example.test/feed.xml", 400],
  ])("rejects URL confusion or unsupported targets: %s", async (target, status) => {
    expect((await GET(request(target))).status).toBe(status);
    expect(mocks.getIssueFeedXml).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("disables external requests unless an exact host is explicitly configured", async () => {
    vi.stubEnv("LEGACY_RSS_HOSTS", "");
    expect((await GET(request("https://feeds.example.test/feed.xml"))).status).toBe(403);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each(["127.0.0.1", "169.254.169.254", "[::1]", "localhost", "cms.local"])("rejects local targets even if mistakenly allowlisted: %s", async host => {
    vi.stubEnv("LEGACY_RSS_HOSTS", host);
    expect((await GET(request(`https://${host}/feed.xml`))).status).toBe(403);
    expect(mocks.request).not.toHaveBeenCalled();
  });
});

describe("Bounded external RSS reading", () => {
  it("uses only validated public DNS answers for the connection and requests no compressed response", async () => {
    const result = await GET(request("https://feeds.example.test/feed.xml"));
    expect(result.status).toBe(200);
    expect(mocks.lookup).toHaveBeenCalledOnce();
    expect(mocks.lookup).toHaveBeenCalledWith("feeds.example.test", { all: true, verbatim: true });
    expect(mocks.request.mock.calls[0][1]).toMatchObject({ agent: false, method: "GET", headers: { "Accept-Encoding": "identity" } });
    expect((await result.json()).items[0].description).toBe("<p>Readable body.</p>");
  });

  it.each(["10.0.0.2", "169.254.169.254", "127.0.0.1", "100.64.0.1", "::1", "fc00::1", "::ffff:127.0.0.1"])("rejects allowlisted host DNS pointing at a nonpublic address: %s", async address => {
    mocks.lookup.mockResolvedValue([{ address, family: address.includes(":") ? 6 : 4 }]);
    const result = await GET(request("https://feeds.example.test/feed.xml"));
    expect(result.status).toBe(403);
    expect((await result.json()).error).toContain("public address");
  });

  it("rejects a mixed public/private DNS answer instead of connecting to an unchecked fallback", async () => {
    mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "192.168.1.5", family: 4 }]);
    expect((await GET(request("https://feeds.example.test/feed.xml"))).status).toBe(403);
  });

  it("does not follow a redirect to an internal service or a second external host", async () => {
    responseStatus = 302;
    responseHeaders = { location: "http://169.254.169.254/latest/meta-data/" };
    const result = await GET(request("https://feeds.example.test/feed.xml"));
    expect(result.status).toBe(422);
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(connections[0].destroy).toHaveBeenCalled();
  });

  it("rejects an oversized declared body before reading it", async () => {
    responseHeaders = { "content-length": String(MAX_RSS_BYTES + 1) };
    expect((await GET(request("https://feeds.example.test/feed.xml"))).status).toBe(413);
    expect(connections[0].destroy).toHaveBeenCalled();
  });

  it("enforces the streaming byte limit even without Content-Length", async () => {
    responseBody = Buffer.alloc(MAX_RSS_BYTES + 1, "x");
    expect((await GET(request("https://feeds.example.test/feed.xml"))).status).toBe(413);
    expect(connections[0].destroy).toHaveBeenCalled();
  });

  it("rejects compression rather than allowing decompression to escape the byte limit", async () => {
    responseHeaders = { "content-encoding": "gzip" };
    expect((await GET(request("https://feeds.example.test/feed.xml"))).status).toBe(422);
  });

  it("times out a stalled response and destroys its connection", async () => {
    vi.useFakeTimers();
    stallResponse = true;
    const pending = GET(request("https://feeds.example.test/feed.xml"));
    await vi.advanceTimersByTimeAsync(RSS_TIMEOUT_MS + 1);
    expect((await pending).status).toBe(504);
    expect(connections[0].destroy).toHaveBeenCalled();
  });
});

describe("Legacy reader content safety", () => {
  it("sanitizes every reader HTML field and rejects active link/media URL schemes", async () => {
    mocks.getIssueFeedXml.mockResolvedValue(`<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Fixture</title><link>javascript:alert(1)</link><description><![CDATA[<p>Overview</p><script>bad()</script>]]></description><item><title>Fixture story</title><link>javascript:alert(2)</link><description><![CDATA[<p onclick="bad()">Body</p><script>bad()</script><img src="https://images.example.test/photo.jpg" onerror="bad()" /><iframe src="https://evil.example"></iframe>]]></description><content:encoded><![CDATA[<p>More text</p><a href="javascript:bad()">Unsafe link</a><svg onload="bad()"></svg>]]></content:encoded><media:content url="javascript:bad()"/><media:content url="https://images.example.test/photo.jpg" type="image/jpeg"/><enclosure url="data:text/html,bad" type="text/html"/></item></channel></rss>`);
    const result = await GET(request("/api/feeds/wa/test-issue/feed.xml"));
    expect(result.status).toBe(200);
    const parsed = await result.json();
    expect(parsed.link).toBeUndefined();
    expect(parsed.description).toBe("<p>Overview</p>");
    const item = parsed.items[0];
    expect(item.link).toBeUndefined();
    expect(item.enclosure).toBeUndefined();
    for (const field of ["description", "contentEncoded", "content", "summary", "content:encoded"]) {
      if (item[field]) expect(item[field]).not.toMatch(/<script|onclick|onerror|<iframe|<svg|javascript:/i);
    }
    expect(item.description).toContain("<p>Body</p>");
    expect(item.contentEncoded).toContain("<p>More text</p>");
    expect(item.mediaContent).toEqual([{ $: { url: "https://images.example.test/photo.jpg", type: "image/jpeg" } }]);
  });

  it("rejects document/entity declarations and returns a private error response", async () => {
    mocks.getIssueFeedXml.mockResolvedValue(`<!DOCTYPE rss [<!ENTITY local SYSTEM "file:///etc/passwd">]>${feed}`);
    const result = await GET(request("/api/feeds/wa/test-issue/feed.xml"));
    expect(result.status).toBe(422);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(JSON.stringify(await result.json())).not.toContain("/etc/passwd");
  });

  it("returns 404 for a missing/unpublished legacy issue", async () => {
    mocks.getIssueFeedXml.mockResolvedValue(null);
    expect((await GET(request("/api/feeds/wa/test-issue/feed.xml"))).status).toBe(404);
  });
});
