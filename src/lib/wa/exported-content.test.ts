import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { esc } from "./seo";
vi.mock("server-only",()=>({}));
import { exportedPage, recipePage, producerPage } from "./exported-content";

describe("public exports in disconnected previews",()=>{
  it("returns initial bottle content and rating metadata without a database",async()=>{
    const data=JSON.parse(readFileSync("public/wa/ratings.json","utf8"));
    const slug=data.rows[0][data.cols.indexOf("slug")];
    const html=await exportedPage(slug,"https://preview.example");
    expect(html).toContain('window.WA_SLUG=');
    expect(html).toContain('"@type":"Product"');
    expect(html).toContain(`https://preview.example/wa/${slug}`);
    expect(html?.match(/id="name"[^>]*>([^<]*)</)?.[1]).toBe(esc(data.rows[0][data.cols.indexOf("n")]));
  });
  it("returns real story text and canonical metadata",async()=>{
    const story=JSON.parse(readFileSync("public/wa/stories.json","utf8"))[0];
    const html=await exportedPage(story.slug,"https://preview.example");
    expect(html).toContain('"@type":"NewsArticle"');
    expect(html).toContain(story.slug);
    expect(html).toMatch(/id="prose">[\s\S]{200,}/);
  });
  it("renders ingredients and Recipe structured data at a durable path",async()=>{
    const recipe=JSON.parse(readFileSync("public/wa/cocktails.json","utf8"))[0];
    const html=await recipePage(recipe.slug,"https://preview.example");
    expect(html).toContain('"@type":"Recipe"');
    expect(html).toContain(`<li>${esc(recipe.ingredients[0])}</li>`);
    expect(html).toContain('/wa/recipes/'+recipe.slug);
    expect(html).toContain('<base href="/wa/">');
  });
  it("renders a producer portfolio without a CMS connection",async()=>{
    const html=await producerPage("Ardbeg","https://preview.example");
    expect(html).toContain('"@type":"CollectionPage"');
    expect(html).toContain("/wa/producers/Ardbeg");
    expect(await producerPage("nonexistent-test-producer","https://preview.example")).toBeNull();
  });
  it("does not substitute an unrelated bottle, story or recipe",async()=>{
    expect(await exportedPage("nonexistent-test-content","https://preview.example")).toBeNull();
    expect(await recipePage("nonexistent-test-content","https://preview.example")).toBeNull();
  });
});
