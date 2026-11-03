import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readWaStaticNames } from "./static-names";

vi.mock("server-only", () => ({}));
const resolveRedirect = vi.fn();
vi.mock("@/lib/cms/redirects-server", () => ({ resolveRedirect: (...args: unknown[]) => resolveRedirect(...args) }));
vi.mock("@/lib/cms/runtime-config", () => ({ deliveryEnabled: () => true, connectedCmsEnabled: () => false }));

let proxy: (request: NextRequest) => Promise<Response>;
beforeAll(async () => {
  // next.config.ts inlines the list at build time; the test hands the proxy the same list.
  vi.stubEnv("WA_STATIC_NAMES", JSON.stringify(readWaStaticNames()));
  proxy = (await import("@/proxy")).proxy as typeof proxy;
});
afterEach(() => { resolveRedirect.mockReset(); vi.unstubAllEnvs(); vi.stubEnv("WA_STATIC_NAMES", JSON.stringify(readWaStaticNames())); });

const call = (host: string, path: string) => proxy(new NextRequest(`https://${host}${path}`, { headers: { host } }));
const rewrite = (r: Response) => { const to = r.headers.get("x-middleware-rewrite"); return to ? new URL(to).pathname + new URL(to).search : null; };

describe("the proxy on whiskyadvocate.com", () => {
  it("serves the site at the root without the database", async () => {
    expect(rewrite(await call("whiskyadvocate.com", "/"))).toBe("/wa/index.html");
    expect(rewrite(await call("whiskyadvocate.com", "/site.css"))).toBe("/wa/site.css");
    expect(rewrite(await call("whiskyadvocate.com", "/Some-Slug?x=1"))).toBe("/wa/Some-Slug?x=1");
    expect(rewrite(await call("www.whiskyadvocate.com", "/recipes/x"))).toBe("/wa/recipes/x");
    const template = await call("whiskyadvocate.com", "/bottle.html");
    expect(rewrite(template)).toBe("/wa/bottle.html");
    expect(template.headers.get("x-robots-tag")).toBe("noindex");
    const old = await call("whiskyadvocate.com", "/wa/Some-Slug?x=1");
    expect(old.status).toBe(301);
    expect(old.headers.get("location")).toBe("https://whiskyadvocate.com/Some-Slug?x=1");
    expect(old.headers.get("cache-control")).not.toBe("private, no-store");
    expect(resolveRedirect).not.toHaveBeenCalled();
  });

  it("keeps serving with the redirect kill switch off", async () => {
    vi.stubEnv("REDIRECTS_AT_EDGE", "false");
    expect(rewrite(await call("whiskyadvocate.com", "/Some-Slug"))).toBe("/wa/Some-Slug");
    expect(rewrite(await call("whiskyadvocate.com", "/"))).toBe("/wa/index.html");
    const deep = await call("whiskyadvocate.com", "/magazine/2019/fall");
    expect(deep.headers.get("x-middleware-next")).toBe("1");
    expect(resolveRedirect).not.toHaveBeenCalled();
  });

  it("redirects multi-segment legacy paths to the root form, and never to themselves", async () => {
    resolveRedirect.mockResolvedValueOnce({ target: "/wa/New-Story", status: 301, brand: "wa" });
    const hit = await call("whiskyadvocate.com", "/products/old-path?ref=1");
    expect(hit.status).toBe(301);
    expect(hit.headers.get("location")).toBe("https://whiskyadvocate.com/New-Story?ref=1");
    resolveRedirect.mockResolvedValueOnce({ target: "/wa/a/b", status: 301, brand: "wa" });
    const self = await call("whiskyadvocate.com", "/A/B");
    expect(self.headers.get("x-middleware-next")).toBe("1");
    resolveRedirect.mockRejectedValueOnce(new Error("database down"));
    const down = await call("whiskyadvocate.com", "/x/y/z");
    expect(down.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("the proxy's root-host details", () => {
  it("gives /index.html the home page as canonical", async () => {
    const r = await call("whiskyadvocate.com", "/index.html");
    expect(rewrite(r)).toBe("/wa/index.html");
    expect(r.headers.get("link")).toBe('<https://whiskyadvocate.com/>; rel="canonical"');
    expect((await call("whiskyadvocate.com", "/")).headers.get("link")).toBeNull();
  });

  it("puts the query before a target's fragment, and reduces absolute root targets to their path", async () => {
    resolveRedirect.mockResolvedValueOnce({ target: "/wa/top20.html#2019", status: 301, brand: "wa" });
    const top = await call("whiskyadvocate.com", "/top20/2019?utm_source=nl");
    expect(top.headers.get("location")).toBe("https://whiskyadvocate.com/top20.html?utm_source=nl#2019");
    resolveRedirect.mockResolvedValueOnce({ target: "https://whiskyadvocate.com/a/b", status: 301, brand: "wa" });
    expect((await call("whiskyadvocate.com", "/a/b")).headers.get("x-middleware-next")).toBe("1");
    resolveRedirect.mockResolvedValueOnce({ target: "https://www.whiskyadvocate.com/wa/x/y", status: 301, brand: "wa" });
    expect((await call("whiskyadvocate.com", "/old/x")).headers.get("location")).toBe("https://whiskyadvocate.com/x/y");
  });

  it("looks up a staging alias under the legacy domain", async () => {
    vi.stubEnv("WA_ROOT_HOSTS", "whiskyadvocate.com,staging.whiskyadvocate.com");
    vi.stubEnv("REDIRECT_HOST_ALIASES", "staging.whiskyadvocate.com=whiskyadvocate.com");
    resolveRedirect.mockResolvedValueOnce({ target: null, status: 410, brand: "wa" });
    expect((await call("staging.whiskyadvocate.com", "/a/retired")).status).toBe(410);
    expect(resolveRedirect).toHaveBeenCalledWith("/a/retired", "whiskyadvocate.com");
  });
});

describe("the proxy on the development host", () => {
  it("leaves /wa and the paths it never saw alone, with no database", async () => {
    for (const path of ["/wa/x", "/wa/site.css", "/reader.js", "/sitemap.xml", "/robots.txt", "/favicon.ico", "/cmsguide"]) {
      const r = await call("rss-project-ten.vercel.app", path);
      expect(r.headers.get("x-middleware-next"), path).toBe("1");
      expect(rewrite(r), path).toBeNull();
    }
    expect(resolveRedirect).not.toHaveBeenCalled();
  });

  it("redirects legacy paths to /wa targets as before", async () => {
    resolveRedirect.mockResolvedValueOnce({ target: "/wa/Some-Story", status: 301, brand: "wa" });
    const r = await call("rss-project-ten.vercel.app", "/some-story");
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("https://rss-project-ten.vercel.app/wa/Some-Story");
    const tag = await call("rss-project-ten.vercel.app", "/tag/bourbon");
    expect(tag.headers.get("location")).toBe("https://rss-project-ten.vercel.app/wa/stories.html#tag=bourbon");
  });
});

describe("the proxy's mark for the site's 404", () => {
  const marked = (r: Response) => r.headers.get("x-middleware-request-x-wa-site-path");
  it("marks site requests it passes on with their path, never the app's", async () => {
    resolveRedirect.mockResolvedValueOnce(null);
    const miss = await call("whiskyadvocate.com", "/a/b");
    expect(miss.headers.get("x-middleware-next")).toBe("1");
    expect(marked(miss)).toBe("/a/b");
    expect(marked(await call("whiskyadvocate.com", "/house-ads/nope.html"))).toBe("/house-ads/nope.html");
    vi.stubEnv("REDIRECTS_AT_EDGE", "false");
    expect(marked(await call("whiskyadvocate.com", "/x/y"))).toBe("/x/y");
    expect(marked(await call("whiskyadvocate.com", "/cms/library"))).toBeNull();
    expect(marked(await call("rss-project-ten.vercel.app", "/a/b"))).toBeNull();
  });
});
