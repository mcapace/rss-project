import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sanitizeHtml from "sanitize-html";
import { esc, renderRating, renderStory, template, type RatingView, type StoryView } from "./seo";

// These are the checked-in public exports, never private CMS documents. Previews can use them safely.
const files = new Map<string, Promise<unknown>>();
async function data<T>(name: string): Promise<T> {
  if (!files.has(name)) files.set(name, readFile(path.join(process.cwd(), "public/wa", name), "utf8").then(JSON.parse).catch(error => { files.delete(name); throw error; }));
  return await files.get(name) as T;
}
function shard(slug: string) { let hash = 0; for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) >>> 0; return String(hash % 64).padStart(2, "0"); }
type Story = { slug: string; title: string; dek: string; sec: string; by: string; d: string; hero: string; tags: string[]; sponsored?: boolean; sponsor?: string; sp?: string | boolean };
type Rating = { slug: string; n: string; s: number; p: number; c: string; pr: string; by: string; issue: string; img: string; d: string };
export type Recipe = { slug: string; name: string; intro: string; ingredients: string[]; method: string; img: string; credit: string; d: string };
export async function exportedPage(slug: string, origin: string): Promise<string | null> {
  const ratings = await data<{cols: string[]; rows: unknown[][]}>("ratings.json");
  const slugIndex = ratings.cols.indexOf("slug");
  const row = ratings.rows.find(r => String(r[slugIndex]).toLowerCase() === slug.toLowerCase());
  if (row) {
    const r = Object.fromEntries(ratings.cols.map((c, i) => [c, row[i]])) as Rating;
    const notes = await data<Record<string,string>>(`notes/${shard(r.slug)}.json`);
    const v: RatingView = { slug:r.slug, name:r.n, score:r.s, price:r.p || null, category:r.c, brand:r.pr, reviewer:r.by, issue:r.issue, note:notes[r.slug] || "", image:r.img, published:r.d ? r.d + "T12:00:00Z" : null, day:r.d, noindex:false };
    return renderRating(await template("bottle.html"),v,origin);
  }
  const stories = (await data<Story[]>("stories.json")).concat(await data<Story[]>("stories-archive.json"));
  const st = stories.find(s => s.slug.toLowerCase() === slug.toLowerCase());
  if (!st) return null;
  const bodies = await data<Record<string,string>>(`articles/${shard(st.slug)}.json`);
  const body = sanitizeHtml(bodies[st.slug] || `<p>${esc(st.dek)}</p>`, { allowedTags:sanitizeHtml.defaults.allowedTags.concat(["img"]), allowedAttributes:{...sanitizeHtml.defaults.allowedAttributes,img:["src","alt","width","height","loading"]} });
  const v: StoryView = { slug:st.slug,title:st.title,description:st.dek,section:st.sec,sectionLabel:st.sec,authors:st.by ? st.by.split(/,\s*/) : [],byline:st.by,published:st.d ? st.d + "T12:00:00Z" : null,modified:null,day:st.d,hero:st.hero,tags:st.tags || [],body,words:body.replace(/<[^>]+>/g," ").split(/\s+/).length,sponsored:!!st.sp || !!st.sponsored || /sponsor/i.test(st.by) || st.tags.some(t=>/^sponsored/i.test(t)),sponsor:st.sponsor || (typeof st.sp === "string" ? st.sp : ""),noindex:false,kind:"article" };
  return renderStory(await template("story.html"),v,origin);
}
export async function recipePage(slug: string, origin: string): Promise<string | null> {
  const r = (await data<Recipe[]>("cocktails.json")).find(r => r.slug === slug);
  if (!r) return null;
  const canonical = `${origin}/wa/recipes/${encodeURIComponent(r.slug)}`;
  const schema = { "@context":"https://schema.org", "@type":"Recipe", name:r.name, image:r.img || undefined, description:r.intro || r.name, recipeIngredient:r.ingredients, recipeInstructions:[{"@type":"HowToStep",text:r.method}], url:canonical, datePublished:r.d || undefined };
  let html = await readFile(path.join(process.cwd(),"public/wa/cocktail.html"),"utf8");
  html = html.replace("<head>", '<head><base href="/wa/">').replace(/<title>.*?<\/title>/,`<title>${esc(r.name)} | Whisky Advocate</title>`).replace("</head>", `<link rel="canonical" href="${esc(canonical)}"><meta name="description" content="${esc(r.intro || r.name)}"><meta property="og:title" content="${esc(r.name)}"><meta property="og:url" content="${esc(canonical)}"><meta property="og:image" content="${esc(r.img)}"><meta property="og:type" content="article"><meta name="twitter:card" content="summary_large_image"><script type="application/ld+json">${JSON.stringify(schema).replace(/</g,"\\u003c")}</script><script>window.WA_RECIPE=${JSON.stringify(r.slug).replace(/</g,"\\u003c")};</script></head>`);
  for (const [id, content] of Object.entries({name:esc(r.name),intro:esc(r.intro),credit:esc(r.credit),ingredients:r.ingredients.map(i=>`<li>${esc(i)}</li>`).join(""),steps:`<p>${esc(r.method)}</p>`})) {
    html = html.replace(new RegExp(`(<([a-z0-9]+)[^>]*id="${id}"[^>]*>)[\\s\\S]*?(</\\2>)`),`$1${content}$3`);
  }
  return html;
}

export async function producerPage(name: string, origin: string): Promise<string | null> {
  const ratings = await data<{cols:string[]; rows:unknown[][]}>("ratings.json");
  const rows = ratings.rows.map(row => Object.fromEntries(ratings.cols.map((c,i)=>[c,row[i]])) as Rating).filter(r=>r.pr === name);
  if (!rows.length || name === "Unknown producer") return null;
  const canonical = `${origin}/wa/producers/${encodeURIComponent(name)}`;
  const description = `${rows.length} published Whisky Advocate ratings for ${name}. Explore the portfolio and tasting notes.`;
  let html = await readFile(path.join(process.cwd(),"public/wa/producer.html"),"utf8");
  const schema = {"@context":"https://schema.org","@type":"CollectionPage",name:`${name} ratings`,description,url:canonical,about:{"@type":"Organization",name}};
  html = html.replace("<head>",'<head><base href="/wa/">').replace(/<title>.*?<\/title>/,`<title>${esc(name)} | Whisky Advocate</title>`).replace("</head>",`<link rel="canonical" href="${esc(canonical)}"><meta name="description" content="${esc(description)}"><meta property="og:title" content="${esc(name)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(canonical)}"><meta property="og:type" content="website"><script type="application/ld+json">${JSON.stringify(schema).replace(/</g,"\\u003c")}</script><script>window.WA_PRODUCER=${JSON.stringify(name).replace(/</g,"\\u003c")};</script></head>`);
  const content = { name:esc(name),lede:esc(description),bottles:rows.slice(0,12).map(r=>`<article class="reader-card"><h3><a href="/wa/${encodeURIComponent(r.slug)}">${esc(r.n)}</a></h3><p>${r.s} points</p></article>`).join("") };
  for (const [id,body] of Object.entries(content)) html=html.replace(new RegExp(`(<([a-z0-9]+)[^>]*id="${id}"[^>]*>)[\\s\\S]*?(</\\2>)`),(_m,open,_tag,close)=>open+body+close);
  return html;
}
