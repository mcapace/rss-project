import { describe, expect, it } from "vitest";
import { clip, slugify, tidy } from "../../../../scripts/wa-media-name";

describe("web names for gallery files", () => {
  it("makes lowercase hyphenated names without filler, sizes, accents or repeats", () => {
    expect(slugify("Aberlour-13-year-old-Double-Cask-Matured-Single-Malt-Scotch_300-0001.png")).toBe("aberlour-13-year-old-double-cask-matured-single-malt-scotch");
    expect(slugify("Hero Image FINAL copy 1600x900 Rieger’s Holiday")).toBe("riegers-holiday");
    expect(slugify("Glenfarclás & Crème Brûlée")).toBe("glenfarclas-creme-brulee");
    expect(slugify("bourbon bourbon barrel barrel")).toBe("bourbon-barrel");
  });
  it("keeps names within 60 characters on a word boundary", () => {
    const slug = slugify("buffalo trace antique collection george t stagg kentucky straight bourbon whiskey bottle studio shot");
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(slug.endsWith("-")).toBe(false);
  });
  it("clips text on a word and drops a dangling separator", () => {
    expect(clip("A short line", 40)).toBe("A short line");
    expect(clip("One two three four five six seven", 20)).toBe("One two three four");
    expect(clip("Bottle — on a bar", 40)).toBe("Bottle, on a bar");
  });
  it("tidies a model answer to the conventions and falls back to the file name", () => {
    const named = tidy({ seo_slug: "Rieger's Holiday Edition Kansas City Whiskey Bottle!", title: "Rieger's Holiday Edition bottle", alt: "image of a green-labelled bottle of Rieger's whiskey", description: "The holiday release.", keywords: ["Rieger's", "rieger's", "kansas city whiskey"], kind: "bottle", brand: "J. Rieger & Co.", product: "Holiday Edition", visible_text: "RIEGER'S" }, "rieger-holiday-bottle-whiskey.tiff");
    expect(named.seo_name).toBe("riegers-holiday-edition-kansas-city-whiskey-bottle");
    expect(named.seo_alt).toBe("A green-labelled bottle of Rieger's whiskey");
    expect(named.keywords).toEqual(["rieger's", "kansas city whiskey"]);
    expect(tidy({ seo_slug: "", kind: "nonsense" }, "Still Austin image.jpg")).toMatchObject({ seo_name: "still-austin", kind: "other" });
  });
});
