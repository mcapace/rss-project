import { describe, expect, it } from "vitest";
import { cosine, priceLimits, rankSimilar, recencyWeight, recentFirst, reviewYear, wantsOlder, type Bottle, type Match } from "./semantic";

const flavor = (axes: Record<string, number>, notes: string[] = []) => ({ v: 1, axes, body: 3, finish: 3, notes, line: "" });
const bottle = (id: string, title: string, brand: string, axes: Record<string, number>, notes: string[] = []): Bottle => ({ id, slug: id, title, rating: { brand, category: "Single Malt Scotch", score: 90, price: 60 }, flavor: flavor(axes, notes) });

describe("priceLimits", () => {
  it("reads price limits", () => {
    expect(priceLimits("smoky scotch under $80")).toEqual({ min: null, max: 80 });
    expect(priceLimits("bourbon over 200 and under $1,500")).toEqual({ min: 200, max: 1500 });
    expect(priceLimits("a gift below 1k")).toEqual({ min: null, max: 1000 });
  });
  it("leaves ages, proofs and scores alone", () => {
    expect(priceLimits("single malt over 12 years old")).toEqual({ min: null, max: null });
    expect(priceLimits("rye above 50% abv")).toEqual({ min: null, max: null });
    expect(priceLimits("bourbon over 95 points")).toEqual({ min: null, max: null });
  });
});

describe("rankSimilar", () => {
  const self = bottle("self", "Ardbeg 10", "Ardbeg", { smoke: 9, maritime: 7, sweet: 3 }, ["peat smoke", "brine", "lemon"]);
  const others = [
    bottle("a1", "Ardbeg Uigeadail", "Ardbeg", { smoke: 9, maritime: 6, dried_fruit: 5 }),
    bottle("a2", "Ardbeg Corryvreckan", "Ardbeg", { smoke: 9, maritime: 7 }),
    bottle("a3", "Ardbeg Wee Beastie", "Ardbeg", { smoke: 9, maritime: 7, sweet: 3 }),
    bottle("l1", "Lagavulin 16", "Lagavulin", { smoke: 8, maritime: 6, sweet: 4 }, ["peat smoke", "brine"]),
    bottle("g1", "Glenmorangie 10", "Glenmorangie", { sweet: 7, fresh_fruit: 7, floral: 5 }),
    bottle("dup", "Ardbeg 10", "Ardbeg", { smoke: 9, maritime: 7, sweet: 3 }),
  ];
  const matches: Match[] = others.map((b, i) => ({ document_id: b.id, kind: "rating", slug: b.slug, title: b.title, similarity: 0.85 - i * 0.01 }));
  const map = new Map(others.map(b => [b.id, b]));

  it("ranks by flavor, caps each house and drops the same bottle", () => {
    const out = rankSimilar(self, matches, map);
    expect(out.map(b => b.slug)).not.toContain("dup");
    expect(out.filter(b => b.brand === "Ardbeg")).toHaveLength(2);
    expect(out.findIndex(b => b.slug === "l1")).toBeLessThan(out.findIndex(b => b.slug === "g1"));
    expect(out.find(b => b.slug === "l1")?.shared).toEqual(["peat smoke", "brine"]);
  });

  it("measures direction, not size", () => {
    expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe("recency", () => {
  it("reads the year from an issue", () => {
    expect(reviewYear("Fall 2026")).toBe(2026);
    expect(reviewYear("Winter 2011")).toBe(2011);
    expect(reviewYear("")).toBeNull();
  });
  it("puts recent reviews first and keeps each group's order", () => {
    const rows = [{ s: "a", issue: "Winter 2012" }, { s: "b", issue: "Fall 2025" }, { s: "c", issue: "" }, { s: "d", issue: "Spring 2022" }];
    expect(recentFirst(rows, r => r.issue, "", 2026).map(r => r.s)).toEqual(["b", "d", "a", "c"]);
  });
  it("leaves the order alone when the reader asks about older bottles", () => {
    const rows = [{ s: "a", issue: "Winter 2012" }, { s: "b", issue: "Fall 2025" }];
    expect(recentFirst(rows, r => r.issue, "discontinued bourbon worth hunting", 2026).map(r => r.s)).toEqual(["a", "b"]);
    expect(wantsOlder("a vintage single malt")).toBe(true);
    expect(wantsOlder("12 year old scotch under $80")).toBe(false);
  });
  it("lifts recent reviews and lowers old ones in bottles like this", () => {
    expect(recencyWeight("Fall 2024", 2026)).toBeGreaterThan(0);
    expect(recencyWeight("Winter 2012", 2026)).toBeLessThan(0);
    expect(recencyWeight(undefined, 2026)).toBe(0);
    const self = bottle("self", "Lagavulin 16", "Lagavulin", { smoke: 8, maritime: 6 });
    const old = { ...bottle("old", "Old Islay", "Old House", { smoke: 8, maritime: 6 }), rating: { brand: "Old House", category: "Single Malt Scotch", issue: "Winter 2012" } };
    const fresh = { ...bottle("new", "New Islay", "New House", { smoke: 8, maritime: 6 }), rating: { brand: "New House", category: "Single Malt Scotch", issue: "Fall 2025" } };
    const matches: Match[] = [old, fresh].map((b, i) => ({ document_id: b.id, kind: "rating", slug: b.slug, title: b.title, similarity: 0.8 - i * 0.02 }));
    const ranked = rankSimilar(self, matches, new Map([old, fresh].map(b => [b.id, b])), { now: 2026 });
    expect(ranked.map(r => r.slug)).toEqual(["new", "old"]);
  });
  it("leans toward the bottle's own price range", () => {
    const self = bottle("self", "Ardbeg 10", "Ardbeg", { smoke: 9, maritime: 7 });
    const dear = { ...bottle("dear", "Old Rare 25", "Rare House", { smoke: 9, maritime: 7 }), rating: { brand: "Rare House", category: "Single Malt Scotch", issue: "Fall 2025", price: 1400 } };
    const near = { ...bottle("near", "Islay 10", "Near House", { smoke: 9, maritime: 7 }), rating: { brand: "Near House", category: "Single Malt Scotch", issue: "Fall 2025", price: 70 } };
    const matches: Match[] = [dear, near].map((b, i) => ({ document_id: b.id, kind: "rating", slug: b.slug, title: b.title, similarity: 0.8 - i * 0.02 }));
    expect(rankSimilar(self, matches, new Map([dear, near].map(b => [b.id, b])), { now: 2026 }).map(r => r.slug)).toEqual(["near", "dear"]);
  });
});
