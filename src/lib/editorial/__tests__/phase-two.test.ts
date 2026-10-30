import { describe, expect, it } from "vitest";
import { sanitizeCmsHtml } from "@/lib/cms/html";
import { heuristicAnalysis, keywordCandidates, readabilityScore } from "../seo-heuristics";
import { colorName, dominantColors, fitCrop, normalizeCrop } from "../image-tools";
import { createDemoData, demoSearch } from "../data";
import { demoDocuments } from "../demo-data";
import { sampleAudience } from "../analytics-sample";
import type { AssistDocument } from "../assist-types";

describe("sanitizer keeps editor styles and embeds while blocking the rest", () => {
  it("keeps whitelisted inline styles and strips anything else", () => {
    const html = '<p style="text-align:center;color:#8c0005;font-family:Georgia, serif;font-size:18px;background:url(https://evil.example);position:fixed">Styled</p><span style="color:rgb(10, 20, 30)">ok</span><mark>hi</mark><pre><code>x</code></pre>';
    const clean = sanitizeCmsHtml(html);
    expect(clean).toContain("text-align:center");
    expect(clean).toContain("color:#8c0005");
    expect(clean).toContain("font-family:Georgia, serif");
    expect(clean).toContain("font-size:18px");
    expect(clean).not.toMatch(/url\(|position/);
    expect(clean).toContain("<mark>hi</mark>");
    expect(clean).toContain("<pre><code>x</code></pre>");
  });
  it("keeps a video embed figure as a link and never as an iframe", () => {
    const clean = sanitizeCmsHtml('<figure data-embed="video"><a href="https://www.youtube.com/watch?v=abc123xyz">Watch on YouTube</a><figcaption>Cap</figcaption></figure><iframe src="https://www.youtube.com/embed/abc"></iframe>');
    expect(clean).toContain('<figure data-embed="video">');
    expect(clean).toContain('href="https://www.youtube.com/watch?v=abc123xyz"');
    expect(clean).not.toContain("<iframe");
  });
  it("still removes hostile markup entirely", () => {
    const clean = sanitizeCmsHtml('<p style="background:url(https://evil.example)">Text</p><img src="data:image/svg+xml,evil"><a href="javascript:alert(1)">x</a>');
    expect(clean).not.toMatch(/style=|data:image|javascript:/);
  });
});

describe("SEO and GEO heuristics", () => {
  const doc: AssistDocument = {
    brand: "wa", kind: "article", title: "Blend", byline: "Sample Editor", excerpt: "", section: "Whisky Life", tags: [], slug: null, public_url: null,
    seo: { title: "", description: "" },
    body_text: "A great blend begins with a clear idea. A great blend needs structure and texture. The blend was made in 2024 at the distillery in Speyside. Blenders choose casks for the blend carefully.",
    media: [{ index: 0, caption: "", alt: "", credit: "", file: "p1.jpg" }],
  };
  it("finds keywords and flags missing basics", () => {
    expect(keywordCandidates(doc.body_text)).toContain("blend");
    const analysis = heuristicAnalysis(doc);
    expect(analysis.source).toBe("heuristic");
    expect(analysis.issues.some(issue => issue.area === "seo" && /description/i.test(issue.message))).toBe(true);
    expect(analysis.issues.some(issue => issue.area === "media")).toBe(true);
    expect(analysis.captions[0]).toMatchObject({ index: 0 });
    expect(analysis.slug).toBe("blend");
    expect(analysis.meta_description.length).toBeLessThanOrEqual(156);
    expect(analysis.scores.seo).toBeLessThan(100);
    expect(readabilityScore(doc.body_text)).toBeGreaterThan(0);
  });
});

describe("image tools", () => {
  it("fits crops to an aspect and keeps them inside the image", () => {
    const crop = fitCrop(1.5, 1, { x: 0.9, y: 0.5 });
    expect(crop.h).toBeCloseTo(1);
    expect(crop.w).toBeCloseTo(1 / 1.5);
    expect(crop.x + crop.w).toBeLessThanOrEqual(1.0001);
    const normalized = normalizeCrop({ x: 0.8, y: 0.8, w: 0.5, h: 0.5 }, 1.5, 16 / 9);
    expect(normalized.x + normalized.w).toBeLessThanOrEqual(1.0001);
    expect(normalized.y + normalized.h).toBeLessThanOrEqual(1.0001);
  });
  it("names colors and finds dominant ones", () => {
    expect(colorName("#8c0005")).toBe("burgundy");
    expect(colorName("#3b74c4")).toBe("blue");
    expect(colorName("not a color")).toBe("");
    const pixels = new Uint8ClampedArray([...Array(40).fill([200, 140, 50, 255]).flat(), ...Array(10).fill([20, 20, 20, 255]).flat()]);
    const palette = dominantColors(pixels, 2);
    expect(palette).toHaveLength(2);
    expect(colorName(palette[0])).toBe("amber");
  });
});

describe("demo search", () => {
  const documents = demoDocuments(new Date("2026-10-30T15:00:00Z"));
  it("finds images by the look described by AI", () => {
    const result = demoSearch(documents, "barrels warehouse", { brand: "wa", scope: "media" });
    expect(result.media.length).toBeGreaterThan(0);
    expect(result.media[0].vision && "description" in result.media[0].vision).toBe(true);
    const color = demoSearch(documents, "sky blue", { scope: "media" });
    expect(color.media.length).toBeGreaterThan(0);
  });
  it("ranks title matches first and highlights snippets", () => {
    const result = demoSearch(documents, "warehouse", { brand: "wa" });
    expect(result.documents[0].title).toMatch(/warehouse/i);
    expect(result.documents[0].headline).toContain("<mark>");
    const keywords = demoSearch(documents, "", { scope: "keywords", brand: "wa" });
    expect(keywords.keywords.some(keyword => keyword.keyword === "whisky life")).toBe(true);
  });
  it("is exposed through the demo data provider", async () => {
    const data = createDemoData(null, () => new Date("2026-10-30T15:00:00Z"));
    const result = await data.search("harvest", { brand: "ws" });
    expect(result.documents.some(hit => /harvest/i.test(hit.title))).toBe(true);
    const audience = await data.audience("ws", 28);
    expect(audience.daily).toHaveLength(28);
    expect(audience.source).toBe("sample");
  });
});

describe("sample analytics", () => {
  it("is deterministic and internally consistent", () => {
    const now = new Date("2026-10-30T15:00:00Z");
    const a = sampleAudience("ca", 7, now), b = sampleAudience("ca", 7, now);
    expect(a.totals.sessions).toBe(b.totals.sessions);
    expect(a.daily.reduce((sum, day) => sum + day.sessions, 0)).toBe(a.totals.sessions);
    expect(a.channels.reduce((sum, channel) => sum + channel.share, 0)).toBeCloseTo(1, 1);
  });
});
