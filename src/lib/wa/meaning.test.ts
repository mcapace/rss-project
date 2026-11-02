import { describe, expect, it } from "vitest";
import { closeMatches } from "./meaning";

const m = (slug: string, similarity: number) => ({ document_id: slug, kind: "article", slug, title: slug, similarity });

describe("closeMatches", () => {
  it("keeps matches near the best one and above the floor", () => {
    expect(closeMatches([m("a", 0.68), m("b", 0.61), m("c", 0.57), m("d", 0.55)]).map(x => x.slug)).toEqual(["a", "b", "c"]);
  });
  it("returns nothing when even the best match is weak", () => {
    expect(closeMatches([m("a", 0.42), m("b", 0.4)])).toEqual([]);
  });
  it("caps the list", () => {
    expect(closeMatches(Array.from({ length: 40 }, (_, i) => m(String(i), 0.7)), { limit: 5 })).toHaveLength(5);
  });
});
