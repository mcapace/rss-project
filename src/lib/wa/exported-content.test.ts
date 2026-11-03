import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { esc } from "./seo";
vi.mock("server-only",()=>({}));
import { exportedPage, recipePage, producerPage } from "./exported-content";
import type { WaSite } from "./site-host";

const DEV: WaSite = { root: false, origin: "https://preview.example", base: "/wa" };
const ROOT: WaSite = { root: true, origin: "https://whiskyadvocate.com", base: "" };

describe("public exports in disconnected previews",()=>{
  it("returns initial bottle content and rating metadata without a database",async()=>{
    const data=JSON.parse(readFileSync("public/wa/ratings.json","utf8"));
    const slug=data.rows[0][data.cols.indexOf("slug")];
    const html=await exportedPage(slug,DEV);
    expect(html).toContain('window.WA_SLUG=');
    expect(html).toContain('"@type":"Product"');
    expect(html).toContain(`https://preview.example/wa/${slug}`);
    expect(html?.match(/id="name"[^>]*>([^<]*)</)?.[1]).toBe(esc(data.rows[0][data.cols.indexOf("n")]));
  });
  it("returns real story text and canonical metadata",async()=>{
    const story=JSON.parse(readFileSync("public/wa/stories.json","utf8"))[0];
    const html=await exportedPage(story.slug,DEV);
    expect(html).toContain('"@type":"NewsArticle"');
    expect(html).toContain(story.slug);
    expect(html).toMatch(/id="prose">[\s\S]{200,}/);
  });
  it("renders ingredients and Recipe structured data at a durable path",async()=>{
    const recipe=JSON.parse(readFileSync("public/wa/cocktails.json","utf8"))[0];
    const html=await recipePage(recipe.slug,DEV);
    expect(html).toContain('"@type":"Recipe"');
    expect(html).toContain(`<li>${esc(recipe.ingredients[0])}</li>`);
    expect(html).toContain('/wa/recipes/'+recipe.slug);
    expect(html).toContain('<base href="/wa/">');
  });
  it("renders a producer portfolio without a CMS connection",async()=>{
    const html=await producerPage("Ardbeg",DEV);
    expect(html).toContain('"@type":"CollectionPage"');
    expect(html).toContain("/wa/producers/Ardbeg");
    expect(await producerPage("nonexistent-test-producer",DEV)).toBeNull();
  });
  it("does not substitute an unrelated bottle, story or recipe",async()=>{
    expect(await exportedPage("nonexistent-test-content",DEV)).toBeNull();
    expect(await recipePage("nonexistent-test-content",DEV)).toBeNull();
  });
  it("builds root-shaped canonicals, base and links on whiskyadvocate.com",async()=>{
    const recipe=JSON.parse(readFileSync("public/wa/cocktails.json","utf8"))[0];
    const html=await recipePage(recipe.slug,ROOT);
    expect(html).toContain(`<link rel="canonical" href="https://whiskyadvocate.com/recipes/${recipe.slug}">`);
    expect(html).toContain('<base href="/">');
    expect(html).toContain('window.WA_BASE="";window.WA_PATHS=true;');
    expect(html).not.toMatch(/["'(]\/wa\//);
    if (recipe.img?.startsWith("/")) expect(html).toContain(`<meta property="og:image" content="https://whiskyadvocate.com${recipe.img}">`);
    const producer=await producerPage("Ardbeg",ROOT);
    expect(producer).toContain('href="https://whiskyadvocate.com/producers/Ardbeg"');
    expect(producer).toContain('<base href="/">');
    expect(producer).toMatch(/<h3><a href="\/[^w/][^"]*">/);
    const story=JSON.parse(readFileSync("public/wa/stories.json","utf8"))[0];
    const page=await exportedPage(story.slug,ROOT);
    expect(page).toContain(`<link rel="canonical" href="https://whiskyadvocate.com/${story.slug}">`);
    expect(page).toContain('window.WA_BASE=""');
  });
  it("keeps the /wa shape on the development host",async()=>{
    const recipe=JSON.parse(readFileSync("public/wa/cocktails.json","utf8"))[0];
    const html=await recipePage(recipe.slug,DEV);
    expect(html).toContain(`<link rel="canonical" href="https://preview.example/wa/recipes/${recipe.slug}">`);
    expect(html).toContain('window.WA_BASE="/wa"');
  });
});
