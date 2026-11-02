import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const catalog = require("../../../public/wa/catalog-core.js");
const exportData = JSON.parse(readFileSync("public/wa/ratings.json", "utf8"));
const ratings = exportData.rows.map((row: unknown[]) => Object.fromEntries(exportData.cols.map((key: string, i: number) => [key, row[i]])));
const recipes = JSON.parse(readFileSync("public/wa/cocktails.json", "utf8"));

describe("catalogue search intent and identity", () => {
  it("keeps every recommendation inside explicit style, price and score constraints", () => {
    const intent = catalog.understand("Best bourbon under $60 rated 90 or higher");
    expect(intent.terms).toEqual([]);
    const hits = catalog.apply(intent, ratings);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((r: {c: string; p: number; s: number}) => /^Bourbon\/Tennessee/.test(r.c) && r.p > 0 && r.p <= 60 && r.s >= 90)).toBe(true);
  });
  it("retains age and batch identity and ranks the requested real bottle first", () => {
    expect(catalog.apply(catalog.understand("Ardbeg 10"), ratings)[0].n).toBe("Ardbeg 10 year old, 46%");
    expect(catalog.nameTerms("Ardbeg 10 under $90 rated 90+ points")).toEqual(["ardbeg", "10"]);
    expect(catalog.nameScore(["10"], {n: "Ardbeg 100 year old", pr: "Ardbeg"})).toBe(0);
    expect(catalog.nameTerms("Elijah Craig A925")).toEqual(["elijah", "craig", "a925"]);
  });
  it("offers spelling corrections without relaxing the budget or requested style", () => {
    const hits = catalog.apply(catalog.understand("ardbge 10 under $90"), ratings);
    expect(hits[0].n).toBe("Ardbeg 10 year old, 46%");
    expect(hits.approximate).toBe(true);
    expect(catalog.apply(catalog.understand("High West bourbon under $60 rated 90 or higher"), [{n:"High West Rye",pr:"High West",c:"Rye Whiskey",p:45,s:95}])).toHaveLength(0);
  });
  it("understands the home page's conversational examples", () => {
    for (const query of ["Smoky Islay for someone who loves Lagavulin", "What rye should I use in a Manhattan?", "Japanese whisky worth the price"]) expect(catalog.apply(catalog.understand(query), ratings).length).toBeGreaterThan(0);
  });
  it("treats category-only queries as searches and retains decimal budgets", () => {
    expect(catalog.apply(catalog.understand("bourbon"), ratings).length).toBeGreaterThan(100);
    expect(catalog.understand("bourbon under $59.50").price).toBe(59.5);
    expect(catalog.apply(catalog.understand("zzzznotawhisky"), ratings)).toHaveLength(0);
  });
});

describe("ingredient matching", () => {
  it("requires lemon juice for a whiskey sour, even though juice contains the letters ice", () => {
    const sour = recipes.find((r: {name:string}) => r.name === "How to Make a Whiskey Sour");
    expect(catalog.missingIngredients(sour,["bourbon","simple syrup"])).toEqual(["¾ oz. fresh-squeezed lemon juice"]);
    expect(catalog.missingIngredients(sour,["bourbon","simple syrup","lemon"])).toEqual([]);
  });
  it("does not substitute fruit, soda or plain syrup for a liqueur or prepared ingredient", () => {
    const r = {ingredients:["1 oz. apple brandy","2 oz. ginger beer","1 oz. gingerbread syrup (recipe below)","Orange peel for garnish"]};
    expect(catalog.missingIngredients(r,["apple","ginger","soda","simple syrup"])).toHaveLength(3);
    expect(catalog.missingIngredients({ingredients:["2 dashes orange bitters"]},["orange"])).toHaveLength(1);
  });
  it("keeps incomplete imports out of recipe discovery", () => {
    expect(catalog.validRecipe({name:"DIRECTIONS",slug:"bad",ingredients:["rye","sugar"],method:"Mix"})).toBe(false);
    expect(catalog.validRecipe({name:"Horse’s Neck",slug:"bad",ingredients:["bourbon Ginger ale to taste Lemon spiral"],method:"Mix"})).toBe(false);
    expect(catalog.validRecipe(recipes.find((r: {name:string}) => r.name === "Poison Apple"))).toBe(true);
  });
});
