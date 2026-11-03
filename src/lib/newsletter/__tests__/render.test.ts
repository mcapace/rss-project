import { describe, expect, it } from "vitest";
import { absoluteEmailLinks, newsletterBody, renderNewsletterHtml, renderNewsletterText, waEmailTarget } from "../render";
import { reciprocalRankFusion } from "@/lib/editorial/rank";

describe("newsletter rendering", () => {
  const input = { brand: "wa" as const, kind: "daily_alert" as const, subject: "Today's alert", preheader: "A quick look", title: "Big news <b>", byline: "Sample Editor", excerpt: "The summary.", section: "News", html: "<p>Lede.</p><h2>One</h2><p>Body.</p><h2>Two</h2><p>More.</p>", url: "https://whiskyadvocate.com/big-news" };

  it("keeps the lede and the first section", () => {
    const { body, truncated } = newsletterBody(input.html);
    expect(body).toBe("<p>Lede.</p><h2>One</h2><p>Body.</p>");
    expect(truncated).toBe(true);
  });

  it("renders a single-column email with escaped headings and a call to action", () => {
    const html = renderNewsletterHtml(input);
    expect(html).toContain("Whisky Advocate · Daily Alert");
    expect(html).toContain("<h1>Big news &lt;b&gt;</h1>");
    expect(html).toContain('class="preheader">A quick look');
    expect(html).toContain('href="https://whiskyadvocate.com/big-news"');
    expect(html).toContain("Continue reading on the site");
    expect(html).not.toContain("<h2>Two</h2>");
    const text = renderNewsletterText(input);
    expect(text).toContain("Big news");
    expect(text).toContain("Read the full story: https://whiskyadvocate.com/big-news");
  });
});

describe("email links", () => {
  it("makes the body's links and pictures absolute at the site's root, with /wa stripped", () => {
    const html = '<p><a href="/wa/Some-Story">a</a> <a href="/Old-Story">b</a> <a href="/wa/">home</a> <a href="/wa/finder.html#q=rye">c</a> <a href="finder.html">d</a> <img src="/api/media/1/2"> <a href="https://example.com/x">e</a> <a href="mailto:x@y.z">f</a> <a href="#top">g</a> <img src="//cdn.example/i.jpg"></p>';
    const out = absoluteEmailLinks(html, "https://whiskyadvocate.com/");
    expect(out).toContain('href="https://whiskyadvocate.com/Some-Story"');
    expect(out).toContain('href="https://whiskyadvocate.com/Old-Story"');
    expect(out).toContain('href="https://whiskyadvocate.com/"');
    expect(out).toContain('href="https://whiskyadvocate.com/finder.html#q=rye"');
    expect(out).toContain('href="https://whiskyadvocate.com/finder.html"');
    expect(out).toContain('src="https://whiskyadvocate.com/api/media/1/2"');
    expect(out).toContain('href="https://example.com/x"');
    expect(out).toContain('href="mailto:x@y.z"');
    expect(out).toContain('href="#top"');
    expect(out).toContain('src="https://cdn.example/i.jpg"');
    expect(out).not.toContain("/wa/");
  });

  it("keeps /wa links on the development host until the domain moves", () => {
    const out = absoluteEmailLinks('<a href="/wa/Some-Story">a</a> <a href="finder.html">b</a> <a href="/Old-Story">c</a>', "https://rss-project-ten.vercel.app", "/wa");
    expect(out).toContain('href="https://rss-project-ten.vercel.app/wa/Some-Story"');
    expect(out).toContain('href="https://rss-project-ten.vercel.app/wa/finder.html"');
    expect(out).toContain('href="https://rss-project-ten.vercel.app/Old-Story"');
  });
});

describe("where a Whisky Advocate email links", () => {
  const doc = { slug: "Made-In-The-CMS", public_url: null, path: "/wa/Made-In-The-CMS" };
  const env = { rootOrigin: "https://whiskyadvocate.com", siteUrl: "https://rss-project-ten.vercel.app/" };
  it("links the development host before the cutover, and the root once WA_ROOT_LIVE is set", () => {
    expect(waEmailTarget(doc, { ...env, live: false })).toEqual({ url: "https://rss-project-ten.vercel.app/wa/Made-In-The-CMS", origin: "https://rss-project-ten.vercel.app", base: "/wa" });
    expect(waEmailTarget({ ...doc, public_url: "https://whiskyadvocate.com/made-in-the-cms" }, { ...env, live: false }).url).toBe("https://whiskyadvocate.com/made-in-the-cms");
    expect(waEmailTarget(doc, { ...env, live: true })).toEqual({ url: "https://whiskyadvocate.com/Made-In-The-CMS", origin: "https://whiskyadvocate.com", base: "" });
  });
});

describe("reciprocal rank fusion", () => {
  it("rewards items that appear in several lists", () => {
    const merged = reciprocalRankFusion([{ items: ["a", "b", "c"] }, { items: ["c", "d"] }], item => item);
    expect(merged.map(entry => entry.item)).toEqual(["c", "a", "b", "d"]);
    expect(merged[0].sources).toBe(2);
  });
});
