import { describe, expect, it } from "vitest";
import { newsletterBody, renderNewsletterHtml, renderNewsletterText } from "../render";
import { reciprocalRankFusion } from "@/lib/editorial/rank";

describe("newsletter rendering", () => {
  const input = { brand: "wa" as const, kind: "daily_alert" as const, subject: "Today's alert", preheader: "A quick look", title: "Big news <b>", byline: "Sample Editor", excerpt: "The summary.", section: "News", html: "<p>Lede.</p><h2>One</h2><p>Body.</p><h2>Two</h2><p>More.</p>", url: "https://whiskyadvocate.com/wa/big-news" };

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
    expect(html).toContain('href="https://whiskyadvocate.com/wa/big-news"');
    expect(html).toContain("Continue reading on the site");
    expect(html).not.toContain("<h2>Two</h2>");
    const text = renderNewsletterText(input);
    expect(text).toContain("Big news");
    expect(text).toContain("Read the full story: https://whiskyadvocate.com/wa/big-news");
  });
});

describe("reciprocal rank fusion", () => {
  it("rewards items that appear in several lists", () => {
    const merged = reciprocalRankFusion([{ items: ["a", "b", "c"] }, { items: ["c", "d"] }], item => item);
    expect(merged.map(entry => entry.item)).toEqual(["c", "a", "b", "d"]);
    expect(merged[0].sources).toBe(2);
  });
});
