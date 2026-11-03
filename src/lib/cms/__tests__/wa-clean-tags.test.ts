import { describe, expect, it } from "vitest";
import { cleanTags, handlesFrom } from "../../../../scripts/wa-clean-tags";

const handles = handlesFrom(["Jonny McCormick, Julia Higgins and Aubrey Thompson", "Sam Barton"]);

describe("wa-clean-tags", () => {
  it("derives usernames from bylines", () => {
    expect([...handles].sort()).toEqual(["athompson", "jhiggins", "jmccormick", "sbarton"]);
  });
  it("drops usernames, the trending flag and the site's own name", () => {
    expect(cleanTags(["jmccormick", "New Releases", "trending", "Rye", "Whisky Advocate", "sbarton", "ddekergommeaux"], handles)).toEqual(["New Releases", "Rye"]);
  });
  it("capitalises lowercase topics and merges case duplicates, keeping numbers", () => {
    expect(cleanTags(["Single Malt", "single malt", "penderyn", "1792", "cryptowhisky"], handles)).toEqual(["Single Malt", "Penderyn", "1792", "Crypto Whisky"]);
  });
  it("leaves a clean list alone", () => {
    expect(cleanTags(["Bourbon", "Buffalo Trace", "1792"], handles)).toBeNull();
  });
});
