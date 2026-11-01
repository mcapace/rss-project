import { describe, expect, it } from "vitest";
import { clip, goodDescription, goodTitle, ratingSeo, tidyStory } from "../../../../scripts/wa-seo-pass";

describe("SEO pass", () => {
  it("judges titles and descriptions by the search rules", () => {
    expect(goodTitle("Laphroaig 16 Year Old Review and Tasting Notes")).toBe(true);
    expect(goodTitle("Short")).toBe(false);
    expect(goodTitle("A".repeat(61))).toBe(false);
    expect(goodDescription("x".repeat(140))).toBe(true);
    expect(goodDescription("x".repeat(100))).toBe(false);
    expect(goodDescription(`${"x".repeat(130)} &amp;`)).toBe(false);
  });
  it("builds a rating's fields from its own data", () => {
    const seo = ratingSeo({ title: "Caol Ila 12 year old, 57.6%", body_html: "<p>Smoky and sweet. Long finish.</p>", excerpt: "", metadata: { rating: { score: 88, price: 79, category: "Single Malt Scotch", brand: "Caol Ila", reviewer: "Dave Broom" }, seo: { description: "short" } } });
    expect(seo.title).toBe("Caol Ila 12 year old: 88 Points");
    expect(String(seo.description).length).toBeLessThanOrEqual(155);
    expect(seo.description).toContain("88 points");
    expect(seo.key_facts).toContain("Bottling strength: 57.6% ABV");
    expect(seo.summary).toBe("Whisky Advocate rated Caol Ila 12 year old 88 points (Single Malt Scotch, $79). Smoky and sweet.");
  });
  it("keeps an editor's good title and description and tidies the rest", () => {
    const existing = { title: "Laphroaig 16 Year Old Review and Tasting Notes", description: "x".repeat(140), no_index: false };
    const out = tidyStory({ title: "Something else entirely", description: "y".repeat(150), focus_keyword: "Laphroaig 16", keywords: ["laphroaig 16", "Islay Scotch"], summary: "A".repeat(400), key_facts: ["one"], entities: [{ name: "Laphroaig", type: "distillery" }, { name: "", type: "brand" }] }, existing, "Doc title");
    expect(out.title).toBe(existing.title);
    expect(out.description).toBe(existing.description);
    expect(out.keywords).toEqual(["islay scotch"]);
    expect(String(out.summary).length).toBeLessThanOrEqual(320);
    expect(out.entities).toEqual([{ name: "Laphroaig", type: "distillery" }]);
  });
  it("clips without dangling separators", () => {
    expect(clip("Bourbon — the long view, explained in full", 20)).toBe("Bourbon, the long");
  });
});
