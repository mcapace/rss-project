import { describe, expect, it } from "vitest";
import { resolveLegacyPath, rewriteLegacyLinks, type LinkMap } from "../../../../scripts/wa-rewrite-legacy-links";

const map: LinkMap = {
  redirects: new Map<string, string | null>([
    ["/ardbeg-uigeadail-54-2", "/wa/Ardbeg-Uigeadail-54-2"],
    ["/top20", "/wa/top20.html"],
    ["/search", null],
    ["/retired-story", null],
  ]),
  slugs: new Map([["brora-reopens", "/wa/Brora-Reopens"]]),
};

describe("resolveLegacyPath", () => {
  it("follows the redirect map, ignoring case, trailing slashes and queries", () => {
    expect(resolveLegacyPath("/Ardbeg-Uigeadail-54-2/?ref=x", map)).toBe("/wa/Ardbeg-Uigeadail-54-2");
    expect(resolveLegacyPath("/", map)).toBe("/wa/");
  });
  it("places the known page families", () => {
    expect(resolveLegacyPath("/top20/2019/3-some-bottle/", map)).toBe("/wa/top20.html#2019");
    expect(resolveLegacyPath("/search?orderBy=rel&amp;q=Sagamore+Spirit", map)).toBe("/wa/finder.html?q=Sagamore%20Spirit");
    expect(resolveLegacyPath("/Tag/bourbon/", map)).toBe("/wa/stories.html");
    expect(resolveLegacyPath("/events/whiskyfest-new-york/", map)).toBe("https://www.whiskyfest.com/");
  });
  it("matches a published slug by the last segment, dropping the old -exist suffix", () => {
    expect(resolveLegacyPath("/brora-reopens-exist", map)).toBe("/wa/Brora-Reopens");
    expect(resolveLegacyPath("/2017/01/02/brora-reopens/", map)).toBe("/wa/Brora-Reopens");
  });
  it("answers null for a page nothing here replaces", () => {
    expect(resolveLegacyPath("/retired-story", map)).toBeNull();
    expect(resolveLegacyPath("/__trashed", map)).toBeNull();
  });
});

describe("rewriteLegacyLinks", () => {
  it("points links here, unwraps dead ones, keeps the store and makes legacy media relative", () => {
    const html = '<p><a href="https://www.whiskyadvocate.com/Ardbeg-Uigeadail-54-2" target="_blank">Ardbeg</a> and <a class="x" href="https://whiskyadvocate.com/retired-story">gone</a> and <a href="https://store.whiskyadvocate.com/products/x">buy</a></p><img src="https://whiskyadvocate.com/api/media/abc/0?w=800">';
    const misses = new Map<string, number>();
    const out = rewriteLegacyLinks(html, map, misses);
    expect(out.html).toBe('<p><a href="/wa/Ardbeg-Uigeadail-54-2" target="_blank">Ardbeg</a> and gone and <a href="https://store.whiskyadvocate.com/products/x">buy</a></p><img src="/api/media/abc/0?w=800">');
    expect(out.changed).toBe(3);
    expect([...misses.keys()]).toEqual(["/retired-story"]);
  });
});
