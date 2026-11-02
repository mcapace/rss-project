import { describe, expect, it } from "vitest";
import { cosine, priceLimits, rankSimilar, type Bottle, type Match } from "./semantic";

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
