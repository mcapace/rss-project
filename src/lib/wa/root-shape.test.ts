import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config as proxyConfig } from "@/proxy";
import { decideRoot, rootRedirect } from "./root-routing";
import { readWaStaticNames } from "./static-names";
import { isRootHost, redirectLookupHost, ROOT_HOST_PATTERN, rootPath, samePath, siteFor, withSearch, type WaSite } from "./site-host";
import { cleanBody, renderRating, renderStory, ratingView, sitePage, sitePageFile, storyView, template, withoutLegacyControls, type WaDoc } from "./seo";
import { robotsTxt } from "./robots";
import { sitemapIndex } from "./feeds";

const ROOT: WaSite = { root: true, origin: "https://whiskyadvocate.com", base: "" };
const DEV: WaSite = { root: false, origin: "https://rss-project-ten.vercel.app", base: "/wa" };
const NAMES = readWaStaticNames();

afterEach(() => { vi.unstubAllEnvs(); });

describe("site host", () => {
  it("knows the root hosts, lowercase and without a port", () => {
    expect(isRootHost("whiskyadvocate.com")).toBe(true);
    expect(isRootHost("WWW.WhiskyAdvocate.com:443")).toBe(true);
    expect(isRootHost("rss-project-ten.vercel.app")).toBe(false);
    expect(isRootHost("localhost:3000")).toBe(false);
    expect(isRootHost("evilwhiskyadvocate.com")).toBe(false);
    vi.stubEnv("WA_ROOT_HOSTS", "staging.whiskyadvocate.com, WhiskyAdvocate.com, staging.example.com");
    expect(isRootHost("staging.whiskyadvocate.com")).toBe(true);
    expect(isRootHost("www.whiskyadvocate.com")).toBe(false);
    // Only whiskyadvocate.com and its subdomains can be root hosts (the proxy matcher and site.js know no others).
    expect(isRootHost("staging.example.com")).toBe(false);
    expect(ROOT_HOST_PATTERN.test("evilwhiskyadvocate.com")).toBe(false);
  });

  it("answers a staging alias with the legacy domain's redirect rows", () => {
    expect(redirectLookupHost("Staging.WhiskyAdvocate.com:443", "staging.whiskyadvocate.com=whiskyadvocate.com")).toBe("whiskyadvocate.com");
    expect(redirectLookupHost("whiskyadvocate.com", "staging.whiskyadvocate.com=whiskyadvocate.com")).toBe("whiskyadvocate.com");
    expect(redirectLookupHost("rss-project-ten.vercel.app", "")).toBe("rss-project-ten.vercel.app");
  });

  it("adds the request's query before a target's fragment", () => {
    expect(withSearch("/top20.html#2019", "?utm_source=nl")).toBe("/top20.html?utm_source=nl#2019");
    expect(withSearch("/x?a=1#h", "?b=2")).toBe("/x?a=1&b=2#h");
    expect(withSearch("/x", "")).toBe("/x");
    expect(withSearch("/x", "?q=1")).toBe("/x?q=1");
  });

  it("maps /wa paths to the root form and leaves everything else", () => {
    expect(rootPath("/wa")).toBe("/");
    expect(rootPath("/wa/")).toBe("/");
    expect(rootPath("/wa/index.html")).toBe("/");
    expect(rootPath("/wa/Some-Story")).toBe("/Some-Story");
    expect(rootPath("/wa/stories.html#tag=rye")).toBe("/stories.html#tag=rye");
    expect(rootPath("/wa/recipes/x?y=1")).toBe("/recipes/x?y=1");
    expect(rootPath("/water")).toBe("/water");
    expect(rootPath("/wax/x")).toBe("/wax/x");
    expect(rootPath("https://whiskyadvocate.com/wa/x")).toBe("https://whiskyadvocate.com/wa/x");
    expect(samePath("/Some-Story/", "/some-story")).toBe(true);
    expect(samePath("/a%20b", "/A b")).toBe(true);
  });

  it("builds the site per host; WA_SITE_ORIGIN applies to root hosts only", () => {
    const req = (host: string, path = "/x") => new Request(`https://${host}${path}`, { headers: { host } });
    expect(siteFor(req("whiskyadvocate.com"))).toEqual(ROOT);
    expect(siteFor(req("www.whiskyadvocate.com"))).toEqual(ROOT);
    expect(siteFor(req("rss-project-ten.vercel.app"))).toEqual(DEV);
    vi.stubEnv("WA_SITE_ORIGIN", "https://www.whiskyadvocate.com/");
    expect(siteFor(req("whiskyadvocate.com")).origin).toBe("https://www.whiskyadvocate.com");
    expect(siteFor(req("rss-project-ten.vercel.app")).origin).toBe("https://rss-project-ten.vercel.app");
  });
});

describe("root host routing", () => {
  const fontInWa = NAMES.shared.fonts?.find(name => name.startsWith("Aeonik")) ?? "Aeonik-Regular.ttf";
  const cases: [string, string, ReturnType<typeof decideRoot>][] = [
    ["/", "", { type: "rewrite", path: "/wa/index.html" }],
    ["/", "?utm=1", { type: "rewrite", path: "/wa/index.html?utm=1" }],
    ["/wa", "", { type: "redirect", location: "/", status: 301 }],
    ["/wa/x", "?q=1", { type: "redirect", location: "/x?q=1", status: 301 }],
    ["/wa/stories.html", "", { type: "redirect", location: "/stories.html", status: 301 }],
    ["/cms", "", { type: "app" }],
    ["/cms/content", "", { type: "app" }],
    ["/login", "", { type: "app" }],
    ["/api/wa/latest", "", { type: "app" }],
    ["/reader.js", "", { type: "rewrite", path: "/wa/reader.js" }],
    ["/reader-core.js", "", { type: "rewrite", path: "/wa/reader-core.js" }],
    ["/robots.txt", "", { type: "next" }],
    ["/llms.txt", "", { type: "next" }],
    ["/site.css", "", { type: "rewrite", path: "/wa/site.css" }],
    ["/index.html", "", { type: "rewrite", path: "/wa/index.html", canonical: "/" }],
    ["/stories.html", "", { type: "rewrite", path: "/wa/stories.html" }],
    ["/story.html", "", { type: "rewrite", path: "/wa/story.html", noindex: true }],
    ["/img/dusk.jpg", "", { type: "rewrite", path: "/wa/img/dusk.jpg" }],
    ["/favicon.ico", "", { type: "rewrite", path: "/wa/favicon.ico" }],
    [`/fonts/${fontInWa}`, "", { type: "rewrite", path: `/wa/fonts/${fontInWa}` }],
    ["/fonts/inter.woff2", "", { type: "next" }],
    ["/brands/x.svg", "", { type: "lookup" }],
    ["/house-ads", "", { type: "redirect", location: "/house-ads/index.html", status: 307 }],
    ["/tag/bourbon", "", { type: "redirect", location: "/stories.html#tag=bourbon", status: 301 }],
    ["/Tag/single-malt", "", { type: "redirect", location: "/stories.html#tag=single%20malt", status: 301 }],
    ["/Some-Slug", "", { type: "rewrite", path: "/wa/Some-Slug" }],
    ["/cmsguide", "", { type: "rewrite", path: "/wa/cmsguide" }],
    ["/how-to-water-your-whisky", "?x=1", { type: "rewrite", path: "/wa/how-to-water-your-whisky?x=1" }],
    ["/sitemap.xml", "", { type: "rewrite", path: "/wa/sitemap.xml" }],
    ["/sitemap-stories.xml", "", { type: "rewrite", path: "/wa/sitemap-stories.xml" }],
    ["/feed.xml", "", { type: "rewrite", path: "/wa/feed.xml" }],
    ["/news-sitemap.xml", "", { type: "rewrite", path: "/wa/news-sitemap.xml" }],
    ["/recipes/old-fashioned", "", { type: "rewrite", path: "/wa/recipes/old-fashioned" }],
    ["/producers/Ardbeg", "", { type: "rewrite", path: "/wa/producers/Ardbeg" }],
    ["/whisky-bars/kentucky", "", { type: "rewrite", path: "/wa/whisky-bars/kentucky" }],
    ["/ratings-reviews/some/old/path", "", { type: "lookup" }],
    ["/magazine/2019/fall", "", { type: "lookup" }],
  ];
  it.each(cases)("%s%s", (path, search, expected) => {
    expect(decideRoot(path, search, NAMES)).toEqual(expected);
  });

  it("reads the public/wa names the proxy is built with", () => {
    expect(NAMES.top).toEqual(expect.arrayContaining(["index.html", "site.css", "reader.js", "img", "fonts", "house-ads", "favicon.ico", "water.html"]));
    expect(NAMES.shared.fonts).toBeDefined();
    expect(NAMES.shared.fonts).not.toContain("inter.woff2");
  });

  it("maps redirect engine answers for the root: WA rows, root targets, no self-redirects", () => {
    expect(rootRedirect({ target: "/wa/Some-Story", status: 301, brand: "wa" }, "/some-story")).toBeNull();
    expect(rootRedirect({ target: "/wa/Some-Story", status: 301, brand: "wa" }, "/Some-Story/")).toBeNull();
    expect(rootRedirect({ target: "/wa/New-Story", status: 301, brand: "wa" }, "/products/old/path")).toEqual({ target: "/New-Story", status: 301 });
    expect(rootRedirect({ target: "/wa/top20.html", status: 308, brand: "wa" }, "/top20/2019")).toEqual({ target: "/top20.html", status: 308 });
    expect(rootRedirect({ target: "https://www.whiskyfest.com/", status: 301, brand: "wa" }, "/whiskyfest/ny")).toEqual({ target: "https://www.whiskyfest.com/", status: 301 });
    expect(rootRedirect({ target: null, status: 410, brand: "wa" }, "/gone/page")).toEqual({ target: null, status: 410 });
    expect(rootRedirect({ target: "/ws/x", status: 301, brand: "ws" }, "/x/y")).toBeNull();
    expect(rootRedirect(null, "/x/y")).toBeNull();
  });

  it("reduces an absolute target on a root host to its path, so it never redirects to itself or hops via /wa", () => {
    expect(rootRedirect({ target: "https://whiskyadvocate.com/a/b", status: 301, brand: "wa" }, "/a/b")).toBeNull();
    expect(rootRedirect({ target: "https://whiskyadvocate.com/Old-Name", status: 301, brand: "wa" }, "/old-name")).toBeNull();
    expect(rootRedirect({ target: "https://www.whiskyadvocate.com/wa/x/y?k=1#f", status: 301, brand: "wa" }, "/old")).toEqual({ target: "/x/y?k=1#f", status: 301 });
    expect(rootRedirect({ target: "https://www.whiskyfest.com/ny", status: 301, brand: "wa" }, "/ny")).toEqual({ target: "https://www.whiskyfest.com/ny", status: 301 });
  });
});

describe("proxy matcher", () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config: proxyConfig, url, headers: { host: new URL(url).host } });
  it("sees the root shape's paths and still skips static build files and the API", () => {
    for (const path of ["/", "/reader.js", "/sitemap.xml", "/robots.txt", "/favicon.ico", "/wa/x", "/wa", "/Some-Slug", "/cmsguide", "/login-help", "/fonts/inter.woff2", "/cms", "/cms/content", "/login", "/admin", "/api/cms/documents"]) {
      expect(matches(`https://whiskyadvocate.com${path}`), path).toBe(true);
    }
    for (const path of ["/_next/static/chunk.js", "/_next/image", "/api/wa/latest", "/api/media/1/2", "/share/x", "/brands-cms/logo.svg"]) {
      expect(matches(`https://whiskyadvocate.com${path}`), path).toBe(false);
    }
    expect(matches("https://staging.whiskyadvocate.com/reader.js")).toBe(true);
  });

  it("keeps the development host on today's matcher, so its /wa files never invoke the proxy", () => {
    for (const path of ["/wa/x", "/wa/site.js", "/wa/house-ads/subscribe/970x90/loop.mp4", "/reader.js", "/sitemap.xml", "/robots.txt", "/favicon.ico", "/_next/static/c.js", "/api/wa/latest"]) {
      expect(matches(`https://rss-project-ten.vercel.app${path}`), path).toBe(false);
    }
    for (const path of ["/", "/Some-Slug", "/products/old/path", "/cms/content", "/login", "/api/cms/documents"]) {
      expect(matches(`https://rss-project-ten.vercel.app${path}`), path).toBe(true);
    }
  });
});

const story: WaDoc = {
  id: "00000000-0000-0000-0000-000000000001", kind: "article", slug: "Some-Story", title: "A Story", byline: "Jane Writer", excerpt: "The summary.",
  body_html: '<p>See <a href="/Other-Story">this</a>, <a href="/wa/Old-Link">that</a>, <a href="/wa/finder.html">ratings</a>, <a href="/wa/">home</a>, <a href="/Blockbuster-Sells-for-2.7-million">dots</a> and <a href="/top20.html">top</a>.</p>',
  metadata: { categories: ["News"] }, published_at: "2026-11-01T12:00:00Z", updated_at: null,
};

describe("server-rendered pages per host", () => {
  it("renders root canonicals, structured data and crumbs on whiskyadvocate.com", async () => {
    const html = renderStory(await template("story.html"), storyView(story, ROOT), ROOT);
    expect(html).toContain('<link rel="canonical" href="https://whiskyadvocate.com/Some-Story">');
    expect(html).toContain('<meta property="og:url" content="https://whiskyadvocate.com/Some-Story">');
    expect(html).toContain('"@id":"https://whiskyadvocate.com/Some-Story#article"');
    expect(html).toContain('"@id":"https://whiskyadvocate.com/#publisher"');
    expect(html).toContain('"item":"https://whiskyadvocate.com/stories.html#news"');
    expect(html).toContain('href="https://whiskyadvocate.com/feed.xml"');
    expect(html).toContain('<a href="/stories.html">Stories</a>');
    expect(html).toContain('<a href="/stories.html#by=Jane%20Writer" rel="author">');
    expect(html).toContain('window.WA_BASE="";');
    expect(html).not.toMatch(/whiskyadvocate\.com\/wa\//);
  });

  it("keeps the /wa shape on the development host", async () => {
    const html = renderStory(await template("story.html"), storyView(story, DEV), DEV);
    expect(html).toContain('<link rel="canonical" href="https://rss-project-ten.vercel.app/wa/Some-Story">');
    expect(html).toContain('"@id":"https://rss-project-ten.vercel.app/wa/#publisher"');
    expect(html).toContain('<a href="/wa/stories.html">Stories</a>');
    expect(html).toContain('window.WA_BASE="/wa";');
    const rating = renderRating(await template("bottle.html"), ratingView({ ...story, kind: "rating", slug: "Some-Bottle", metadata: { rating: { score: 92 } } }, DEV), DEV);
    expect(rating).toContain('<link rel="canonical" href="https://rss-project-ten.vercel.app/wa/Some-Bottle">');
    expect(rating).toContain('"item":"https://rss-project-ten.vercel.app/wa/finder.html"');
    const rootRating = renderRating(await template("bottle.html"), ratingView({ ...story, kind: "rating", slug: "Some-Bottle", metadata: { rating: { score: 92 } } }, ROOT), ROOT);
    expect(rootRating).toContain('<link rel="canonical" href="https://whiskyadvocate.com/Some-Bottle">');
  });

  it("cleans body links both ways", () => {
    const body = story.body_html as string;
    const root = cleanBody(body, "");
    expect(root).toContain('href="/Other-Story"');
    expect(root).toContain('href="/Old-Link"');
    expect(root).toContain('href="/finder.html"');
    expect(root).toContain('<a href="/">home</a>');
    expect(root).toContain('href="/Blockbuster-Sells-for-2.7-million"');
    const dev = cleanBody(body, "/wa");
    expect(dev).toContain('href="/wa/Other-Story"');
    expect(dev).toContain('href="/wa/Old-Link"');
    expect(dev).toContain('href="/wa/Blockbuster-Sells-for-2.7-million"');
    expect(dev).toContain('href="/top20.html"');
    expect(cleanBody('<a href="/x" onclick="evil()">x</a><script>bad()</script>', "")).toBe('<a href="/x">x</a>');
  });
});

describe("robots.txt and the sitemap index per host", () => {
  it("opens the site at the root and closes only the app, by whole segment", () => {
    const txt = robotsTxt(ROOT);
    expect(txt).toContain("Disallow: /reader/\nDisallow: /reader$");
    expect(txt).not.toMatch(/Disallow: \/reader\n/);
    expect(txt).toContain("Disallow: /cms/\nDisallow: /cms$");
    expect(txt).toContain("Allow: /api/media/\nAllow: /api/wa/\nDisallow: /api/");
    expect(txt).toContain("User-agent: GPTBot\nDisallow: /");
    expect(txt).toContain("Sitemap: https://whiskyadvocate.com/sitemap.xml\nSitemap: https://whiskyadvocate.com/news-sitemap.xml");
  });
  it("keeps today's robots.txt on other hosts", () => {
    const txt = robotsTxt(DEV);
    expect(txt).toContain("User-agent: *\nAllow: /\nDisallow: /cms\nDisallow: /admin\nDisallow: /api/\nDisallow: /login\nDisallow: /reader\nDisallow: /share/\nDisallow: /brands-cms\n");
    expect(txt).toContain("Sitemap: https://rss-project-ten.vercel.app/wa/sitemap.xml");
  });
  it("lists the sitemaps at the host's shape", () => {
    expect(sitemapIndex(ROOT, "2026-11-03")).toContain("<loc>https://whiskyadvocate.com/sitemap-stories.xml</loc><lastmod>2026-11-03</lastmod>");
    expect(sitemapIndex(ROOT)).toContain("<loc>https://whiskyadvocate.com/news-sitemap.xml</loc>");
    expect(sitemapIndex(DEV)).toContain("<loc>https://rss-project-ten.vercel.app/wa/sitemap-ratings.xml</loc>");
  });
});

describe("a story served by a site page", () => {
  const water: WaDoc = { ...story, id: "f03bc6be-95ed-4c39-92c1-f4baafc4a475", slug: "how-to-water-your-whisky", title: "How to Water Your Whisky", body_html: "<p>Add a few drops.</p>", metadata: { categories: ["Guides"], page_file: "water.html", media: [{ is_lead: true, s3_key: "k" }] } };
  it("serves water.html at the story's URL with the story's head tags for each host", async () => {
    const file = sitePageFile(water.metadata);
    expect(file).toBe("water.html");
    const root = await sitePage(file, storyView(water, ROOT), ROOT);
    expect(root).toContain('<link rel="canonical" href="https://whiskyadvocate.com/how-to-water-your-whisky">');
    expect(root).toContain('<meta property="og:url" content="https://whiskyadvocate.com/how-to-water-your-whisky">');
    expect(root).toContain('<meta property="og:type" content="article">');
    expect(root).toContain('<meta property="og:title" content="How to Water Your Whisky">');
    expect(root).toContain('<meta property="og:image" content="https://whiskyadvocate.com/api/media/f03bc6be-95ed-4c39-92c1-f4baafc4a475/0?w=1600">');
    expect(root).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(root).toContain('"@type":"BreadcrumbList"');
    expect(root).toContain('"@id":"https://whiskyadvocate.com/how-to-water-your-whisky#article"');
    expect(root).toContain('<meta name="robots" content="index, follow');
    expect(root).toContain('window.WA_BASE="";');
    expect(root).toContain('id="field"');
    for (const tag of [/rel="canonical"/g, /name="description"/g, /<title>/g]) expect(root?.match(tag), String(tag)).toHaveLength(1);
    const dev = await sitePage(file, storyView(water, DEV), DEV);
    expect(dev).toContain('<link rel="canonical" href="https://rss-project-ten.vercel.app/wa/how-to-water-your-whisky">');
    expect(dev).toContain('window.WA_BASE="/wa";');
  });
  it("shows the story below the tool and points the tool's credit links at it", async () => {
    const root = (await sitePage("water.html", storyView({ ...water, byline: "Charles K. Cowdery" }, ROOT), ROOT))!;
    const source = root.indexOf('id="source"');
    expect(source).toBeGreaterThan(root.indexOf('id="wtFind"'));
    expect(source).toBeLessThan(root.indexOf('class="nl-band"'));
    expect(root).toContain('<h2 class="d2" style="margin-top: 12px" id="sourceTitle">How to Water Your Whisky</h2>');
    expect(root).toContain("<p>Add a few drops.</p>");
    expect(root).toContain('href="/stories.html#by=Charles%20K.%20Cowdery"');
    expect(root).not.toMatch(/<a\b[^>]*href="(?:https:\/\/whiskyadvocate\.com)?\/(?:wa\/)?how-to-water-your-whisky"/);
    expect(root.match(/href="#source"/g)?.length).toBeGreaterThanOrEqual(2);
    const dev = (await sitePage("water.html", storyView(water, DEV), DEV))!;
    expect(dev).not.toContain('href="/wa/how-to-water-your-whisky"');
    expect(dev).toContain('id="source"');
  });
  it("keeps the story's noindex", async () => {
    const hidden = await sitePage("water.html", storyView({ ...water, metadata: { ...water.metadata, seo: { no_index: true } } }, ROOT), ROOT);
    expect(hidden).toContain('<meta name="robots" content="noindex, follow">');
  });
  it("replaces an existing canonical, and refuses names that are not a site page", async () => {
    const other = await sitePage("about.html", storyView({ ...story, slug: "about-us" }, ROOT), ROOT);
    expect(other?.match(/rel="canonical"/g)).toHaveLength(1);
    expect(other).toContain('<link rel="canonical" href="https://whiskyadvocate.com/about-us">');
    for (const bad of ["../secrets.html", "Water.html", "water.js", "", "nope-missing.html"]) expect(await sitePage(sitePageFile({ page_file: bad }), storyView(story, ROOT), ROOT)).toBeNull();
    expect(sitePageFile({})).toBeNull();
  });
});

describe("withoutLegacyControls", () => {
  it("drops the old inline calculators and leaves one pointer to the tool for each", () => {
    const body = '<p>Intro.</p>\n<p></p>\n<div class="calc" style="x"><div id="a"><div class="g"><input type="number" placeholder="A" /></div>\n<div class="b"><button>Calculate</button></div></div></div>\n<p>Middle.</p>\n<div><input name="r" /></div>\n<p>End.</p>';
    const out = withoutLegacyControls(body);
    expect(out).not.toMatch(/<input|<button|class="calc"/);
    expect(out.match(/href="#wtFind"/g)).toHaveLength(2);
    expect(out).toContain("<p>Intro.</p>\n<p></p>");
    expect(out).toContain("<p>Middle.</p>");
    expect(withoutLegacyControls("<p>Plain.</p>")).toBe("<p>Plain.</p>");
  });
});

describe("site page review fixes", () => {
  const water: WaDoc = { ...story, slug: "how-to-water-your-whisky", title: "How to Water Your Whisky", byline: "Charles K. Cowdery", body_html: '<p>Formula.</p>\n<div id="perfect-proof" class="calculator"><div><input placeholder="A" /></div><div><button>Calculate</button></div></div>\n<p>Then.</p>\n<div id="amount-water-to-add"><input /></div>', metadata: { categories: ["Guides"], page_file: "water.html" } };
  it("points each old calculator at the matching part of the tool", async () => {
    const html = (await sitePage("water.html", storyView(water, ROOT), ROOT))!;
    expect(html).toContain('<p class="muted"><a href="#wtPerfect">Use Find your perfect proof on this page.</a></p>');
    expect(html).toContain('<p class="muted"><a href="#wtFind">Use the calculator at the top of this page.</a></p>');
    expect(html).toContain('id="wtPerfect"');
  });
  it("keeps markup valid when a control sits inside a sentence, and removes controls without pointers off the tool", () => {
    const out = withoutLegacyControls('<p>Enter proof <input type="number"> then</p>');
    expect(out).toBe('<p>Enter proof <span class="muted"><a href="#wtFind">Use the calculator at the top of this page.</a></span> then</p>');
    expect(withoutLegacyControls('<p>A</p><div><input></div><p>B</p>', null)).toBe("<p>A</p>\n<p>B</p>");
  });
  it("uses a plain kicker on other pages and keeps a sponsored story's label and disclosure", async () => {
    const other = (await sitePage("about.html", storyView({ ...story, slug: "about-us" }, ROOT), ROOT))!;
    expect(other).not.toContain("The guide behind the tool");
    const paid = (await sitePage("water.html", storyView({ ...water, metadata: { ...water.metadata, sponsored: { on: true, by: "Acme Spirits" } } }, ROOT), ROOT))!;
    const src = paid.slice(paid.indexOf('id="source"'));
    expect(src).toContain('<span class="sp-chip">Sponsored</span>');
    expect(src).toContain("Sponsored by <strong>Acme Spirits</strong>");
    expect(src).toContain('class="sp-note"');
  });
});
