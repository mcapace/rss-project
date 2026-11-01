import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cmsDb } from "@/lib/cms/db";
import { sponsorship } from "@/lib/cms/sponsored";

/**
 * Server-rendered Whisky Advocate pages for search engines and AI crawlers (2026-11-01).
 *
 * The concept site's pages are static templates that read their story or bottle from the URL hash, so every
 * story was one URL to a crawler and the text only existed after JavaScript ran. /wa/<slug> (the path every
 * legacy whiskyadvocate.com URL already redirects to) now returns the same template with the content, head
 * tags and structured data filled in on the server. Sitemaps, the Google News sitemap, the feed and llms.txt
 * read the same documents.
 */

export const PUBLISHER = "Whisky Advocate";
export const BASE = "/wa";
const LEGACY_ORIGIN = "https://whiskyadvocate.com";
const SECTION: Record<string, string> = { News: "news", Features: "features", Insights: "features", "Whisky Life": "life", Travel: "travel", Cocktails: "cocktails", Guides: "guides" };
const SECTION_LABEL: Record<string, string> = { news: "News", features: "Features", life: "Whisky Life", travel: "Travel", cocktails: "Cocktails", guides: "Guides" };

/** The public origin for canonical URLs: WA_SITE_ORIGIN when set (the production domain), else the request's. */
export function siteOrigin(request: Request): string {
  const configured = process.env.WA_SITE_ORIGIN?.replace(/\/+$/, "");
  return configured || new URL(request.url).origin;
}

export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}
export function xmlEsc(value: unknown): string { return esc(value); }
function jsonLd(data: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}
function plain(html: string): string {
  return html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;|&quot;/g, '"').replace(/&mdash;|&ndash;/g, ", ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
}
function clip(text: string, max: number): string { return text.length <= max ? text : text.slice(0, max - 1).replace(/\s+\S*$/, "") + "…"; }
function absUrl(src: string | null | undefined): string {
  if (!src) return "";
  if (/^https?:\/\//i.test(src)) return src.replace(/^http:\/\//i, "https://");
  if (src.startsWith("//")) return "https:" + src;
  return LEGACY_ORIGIN + (src.startsWith("/") ? src : "/" + src);
}

type Meta = Record<string, unknown>;
export type WaDoc = { id: string; kind: string; slug: string; title: string; byline: string | null; excerpt: string | null; body_html: string | null; metadata: Meta | null; published_at: string | null; updated_at: string | null };

const DOC_FIELDS = "id,kind,slug,title,byline,excerpt,body_html,metadata,published_at,updated_at";

/** One published Whisky Advocate document by slug, any capitalization. */
export async function loadDoc(slug: string): Promise<WaDoc | null> {
  const clean = slug.replace(/[%_\\]/g, c => "\\" + c).slice(0, 300);
  const { data, error } = await cmsDb().from("cms_documents").select(DOC_FIELDS).eq("brand", "wa").eq("publication_state", "published").ilike("slug", clean).limit(2);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as WaDoc[];
  return rows.find(r => r.slug === slug) ?? rows[0] ?? null;
}

/**
 * Every published document of the given kinds, newest first, a page at a time (PostgREST caps a request at 1,000
 * rows). Only the metadata the sitemaps and feed read is selected, not whole documents.
 */
const LITE = "slug,kind,title,byline,excerpt,published_at,updated_at,legacy_dates:metadata->legacy_dates,legacy_media:metadata->legacy_media,lead_image:metadata->lead_image,sponsored:metadata->sponsored,tags:metadata->tags,seo:metadata->seo,legacy_seo:metadata->legacy_seo,ai_summary:metadata->>ai_summary,categories:metadata->categories";
export async function listDocs(kinds: string[], limit = 60000): Promise<WaDoc[]> {
  const out: WaDoc[] = [];
  for (let from = 0; from < limit; from += 1000) {
    const { data, error } = await cmsDb().from("cms_documents").select(LITE).eq("brand", "wa").eq("publication_state", "published").in("kind", kinds).not("slug", "is", null)
      .order("metadata->legacy_dates->>published_date", { ascending: false, nullsFirst: false }).order("id").range(from, Math.min(from + 999, limit - 1));
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      const { legacy_dates, legacy_media, lead_image, sponsored, tags, seo, legacy_seo, ai_summary, categories, ...rest } = row;
      out.push({ ...(rest as unknown as WaDoc), body_html: null, id: "", metadata: { legacy_dates, legacy_media, lead_image, sponsored, tags, seo, legacy_seo, ai_summary, categories } as Meta });
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

const obj = (v: unknown): Meta => (v && typeof v === "object" && !Array.isArray(v) ? v as Meta : {});
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);

/** A legacy stamp ("20240528044400") or date ("2024-05-28") as ISO 8601 in New York time, where the old CMS ran. */
function legacyIso(stamp: unknown, date: unknown): string | null {
  const s = typeof stamp === "string" && /^\d{14}$/.test(stamp) ? stamp : null;
  const d = typeof date === "string" && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null;
  const local = s ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}` : d ? `${d}T09:00:00` : null;
  if (!local || local.startsWith("0000")) return null;
  const probe = new Date(local + "Z");
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" }).formatToParts(probe).find(p => p.type === "timeZoneName")?.value ?? "GMT-5";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  const offset = m ? `${m[1]}${m[2].padStart(2, "0")}:${m[3] ?? "00"}` : "-05:00";
  return local + offset;
}

export function docDates(doc: Pick<WaDoc, "metadata" | "published_at" | "updated_at">): { published: string | null; modified: string | null; day: string | null } {
  const dates = obj(obj(doc.metadata).legacy_dates);
  const published = doc.published_at ?? legacyIso(dates.publish_dateStamp, dates.published_date);
  // The migration touched every row, so updated_at is not an edit date; the old CMS's own modified stamp is.
  const modified = legacyIso(dates.modified, null) ?? published;
  const day = typeof dates.published_date === "string" ? dates.published_date.slice(0, 10) : published?.slice(0, 10) ?? null;
  return { published, modified: modified && published && modified < published ? published : modified, day };
}

export function heroOf(doc: Pick<WaDoc, "metadata">): string {
  const meta = obj(doc.metadata);
  const lead = obj(meta.lead_image);
  const media = obj(meta.legacy_media);
  const first = Array.isArray(meta.media) ? obj(meta.media[0]) : {};
  return absUrl((lead.url as string) || (first.url as string) || (first.src as string) || (media.thumb_file as string) || "");
}

export function isNoIndex(doc: Pick<WaDoc, "metadata">): boolean {
  const seo = obj(obj(doc.metadata).seo);
  return seo.no_index === true || obj(obj(doc.metadata).legacy_seo).no_index === "1";
}

function authorsOf(byline: string | null): string[] {
  return (byline || "").split(/\s*,\s*|\s+and\s+|\s*&\s*/).map(s => s.trim()).filter(s => s && !/sponsor/i.test(s));
}

/** The body as the site shows it: no scripts, legacy pictures on the old host, old internal links to our own pages. */
function cleanBody(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\s(on[a-z]+)=("[^"]*"|'[^']*')/gi, "")
    .replace(/(<(?:img|source)\b[^>]*?\s(?:src|srcset)=")(\/(?!\/)[^"]*)"/gi, (_m, a: string, v: string) => `${a}${LEGACY_ORIGIN}${v}"`)
    .replace(/(<a\b[^>]*?\shref=")\/(?!\/)([^"/?#]+)"/gi, (_m, a: string, v: string) => (/\.[a-z0-9]{2,4}$/i.test(v) ? `${a}${LEGACY_ORIGIN}/${v}"` : `${a}${BASE}/${v}"`))
    .replace(/(<a\b[^>]*?\shref=")\/(?!\/)([^"]*)"/gi, (_m, a: string, v: string) => `${a}${LEGACY_ORIGIN}/${v}"`);
}

/** Put inner HTML into the first element carrying id="<id>" (which the template leaves empty). */
function fill(html: string, id: string, inner: string): string {
  const re = new RegExp(`(<([a-z0-9]+)\\b[^>]*\\bid="${id}"[^>]*>)([\\s\\S]*?)(</\\2>)`, "i");
  return html.replace(re, (_m, open: string, _tag: string, _old: string, close: string) => open + inner + close);
}
function head(html: string, title: string, tags: string): string {
  return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`).replace(/<\/head>/i, `${tags}\n</head>`);
}
/** Tell the template which item it shows (it otherwise reads the URL hash) and that links may use clean paths. */
function boot(html: string, slug: string): string {
  return html.replace(/<script src="site\.js"><\/script>/, `<script>window.WA_SLUG=${JSON.stringify(slug).replace(/</g, "\\u003c")};window.WA_PATHS=true;</script>\n<script src="site.js"></script>`);
}

const templates = new Map<string, string>();
export async function template(name: "story.html" | "bottle.html"): Promise<string> {
  const hit = templates.get(name);
  if (hit) return hit;
  const html = await readFile(path.join(process.cwd(), "public", "wa", name), "utf8");
  templates.set(name, html);
  return html;
}

function publisher(origin: string) {
  return { "@type": "Organization", "@id": `${origin}${BASE}/#publisher`, name: PUBLISHER, url: `${origin}${BASE}/`, logo: { "@type": "ImageObject", url: `${origin}${BASE}/img/icon-192.png`, width: 192, height: 192 }, sameAs: ["https://www.instagram.com/whiskyadvocate/", "https://www.facebook.com/whiskyadvocate", "https://twitter.com/whiskyadvocate", "https://www.youtube.com/channel/UCSNVtQgcKnSqZF3qXT_aQFg"] };
}

function commonTags(o: { title: string; description: string; canonical: string; image: string; type: string; noindex: boolean; origin: string }): string {
  const robots = o.noindex ? "noindex, follow" : "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";
  return [
    `<meta name="description" content="${esc(o.description)}">`,
    `<link rel="canonical" href="${esc(o.canonical)}">`,
    `<meta name="robots" content="${robots}">`,
    `<meta property="og:site_name" content="${PUBLISHER}">`,
    `<meta property="og:locale" content="en_US">`,
    `<meta property="og:type" content="${o.type}">`,
    `<meta property="og:title" content="${esc(o.title)}">`,
    `<meta property="og:description" content="${esc(o.description)}">`,
    `<meta property="og:url" content="${esc(o.canonical)}">`,
    o.image ? `<meta property="og:image" content="${esc(o.image)}">` : "",
    `<meta name="twitter:card" content="${o.image ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:site" content="@whiskyadvocate">`,
    `<meta name="twitter:title" content="${esc(o.title)}">`,
    `<meta name="twitter:description" content="${esc(o.description)}">`,
    o.image ? `<meta name="twitter:image" content="${esc(o.image)}">` : "",
    `<link rel="alternate" type="application/rss+xml" title="${PUBLISHER}" href="${o.origin}${BASE}/feed.xml">`,
  ].filter(Boolean).join("\n");
}

export type StoryView = { slug: string; title: string; description: string; section: string; sectionLabel: string; authors: string[]; byline: string; published: string | null; modified: string | null; day: string | null; hero: string; tags: string[]; body: string; words: number; sponsored: boolean; sponsor: string; noindex: boolean; kind: string };

export function storyView(doc: WaDoc): StoryView {
  const meta = obj(doc.metadata);
  const seo = obj(meta.seo);
  const cats = strs(meta.categories);
  const tags = strs(meta.ai_tags).length ? strs(meta.ai_tags) : strs(meta.tags).filter(t => !cats.includes(t) && !/^[a-z0-9_]+$/.test(t));
  const section = SECTION[cats[0] ?? ""] ?? (doc.kind === "article" ? "news" : "features");
  const body = cleanBody(doc.body_html || "");
  const text = plain(body);
  const description = clip(plain(String(seo.description || doc.excerpt || meta.ai_summary || "")) || text, 300);
  const sp = sponsorship(meta, doc.byline);
  const dates = docDates(doc);
  return { slug: doc.slug, title: plain(doc.title), description, section, sectionLabel: SECTION_LABEL[section] ?? "Stories", authors: authorsOf(doc.byline), byline: doc.byline || "", published: dates.published, modified: dates.modified, day: dates.day, hero: heroOf(doc), tags: tags.slice(0, 12), body, words: text ? text.split(" ").length : 0, sponsored: sp.on, sponsor: sp.by, noindex: isNoIndex(doc), kind: doc.kind };
}

function longDate(day: string | null): string {
  if (!day) return "";
  return new Date(day + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function storyJsonLd(v: StoryView, origin: string): unknown[] {
  const canonical = `${origin}${BASE}/${v.slug}`;
  const isArticle = v.kind === "article";
  const article: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": v.sponsored ? "AdvertiserContentArticle" : isArticle ? "NewsArticle" : "Article",
    "@id": `${canonical}#article`,
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    url: canonical,
    headline: clip(v.title, 110),
    description: v.description,
    image: v.hero ? [v.hero] : undefined,
    datePublished: v.published ?? undefined,
    dateModified: v.modified ?? v.published ?? undefined,
    author: v.authors.length ? v.authors.map(name => ({ "@type": "Person", name, url: `${origin}${BASE}/stories.html#by=${encodeURIComponent(name)}` })) : { "@type": "Organization", name: PUBLISHER, url: `${origin}${BASE}/` },
    publisher: publisher(origin),
    articleSection: v.sectionLabel,
    keywords: v.tags.length ? v.tags.join(", ") : undefined,
    wordCount: v.words || undefined,
    inLanguage: "en-US",
    isAccessibleForFree: true,
  };
  if (v.sponsored) article.sponsor = { "@type": "Organization", name: v.sponsor || "Advertiser" };
  const crumbs = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: PUBLISHER, item: `${origin}${BASE}/` },
    { "@type": "ListItem", position: 2, name: v.sectionLabel, item: `${origin}${BASE}/stories.html#${v.section}` },
    { "@type": "ListItem", position: 3, name: v.title, item: canonical },
  ] };
  return [article, crumbs];
}

export function renderStory(templateHtml: string, v: StoryView, origin: string): string {
  const canonical = `${origin}${BASE}/${v.slug}`;
  let html = head(templateHtml, `${v.title} | ${PUBLISHER}`, [
    commonTags({ title: v.title, description: v.description, canonical, image: v.hero, type: "article", noindex: v.noindex, origin }),
    v.published ? `<meta property="article:published_time" content="${esc(v.published)}">` : "",
    v.modified ? `<meta property="article:modified_time" content="${esc(v.modified)}">` : "",
    `<meta property="article:section" content="${esc(v.sectionLabel)}">`,
    ...v.tags.map(t => `<meta property="article:tag" content="${esc(t)}">`),
    ...v.authors.map(a => `<meta property="article:author" content="${esc(a)}">`),
    v.authors.length ? `<meta name="author" content="${esc(v.authors.join(", "))}">` : "",
    ...storyJsonLd(v, origin).map(jsonLd),
  ].filter(Boolean).join("\n"));
  html = fill(html, "crumbs", `<a href="${BASE}/stories.html">Stories</a> › <a href="${BASE}/stories.html#${v.section}">${esc(v.sectionLabel)}</a>`);
  html = fill(html, "kicker", (v.sponsored ? '<span class="sp-chip">Sponsored</span>' : "") + esc(v.sectionLabel) + (v.tags[0] && !/sponsor/i.test(v.tags[0]) ? " · " + esc(v.tags[0]) : ""));
  html = fill(html, "title", esc(v.title));
  html = fill(html, "dek", esc(v.description));
  const date = v.day ? `<time datetime="${esc(v.published ?? v.day)}">${esc(longDate(v.day))}</time>` : "";
  const who = v.sponsored ? `<span>${v.sponsor ? `Sponsored by <strong>${esc(v.sponsor)}</strong>` : "<strong>Sponsored content</strong>"}</span>` : v.authors.length ? `<span>By ${v.authors.map(a => `<a href="${BASE}/stories.html#by=${encodeURIComponent(a)}" rel="author"><strong>${esc(a)}</strong></a>`).join(", ")}</span>` : "";
  html = fill(html, "byline", `${who}<span>${date}</span>${v.words ? `<span>${Math.max(1, Math.round(v.words / 230))} minute read</span>` : ""}`);
  if (v.hero) html = html.replace(/<figure class="figure story-hero" id="hero" hidden><img src="" alt="">/, `<figure class="figure story-hero" id="hero"><img src="${esc(v.hero)}" alt="${esc(v.title)}" fetchpriority="high">`);
  const disclosure = v.sponsored ? `<p class="sp-note" role="note">This is paid content, produced with ${esc(v.sponsor || "an advertiser")}. It is not part of Whisky Advocate&rsquo;s editorial coverage, and it does not affect our ratings.</p>` : "";
  html = fill(html, "prose", disclosure + v.body);
  return boot(html, v.slug);
}

export type RatingView = { slug: string; name: string; score: number | null; price: number | null; category: string; brand: string; reviewer: string; issue: string; note: string; image: string; published: string | null; day: string | null; noindex: boolean };

export function ratingView(doc: WaDoc): RatingView {
  const meta = obj(doc.metadata);
  const r = obj(meta.rating);
  const score = Number(r.score);
  const price = Number(r.price);
  return { slug: doc.slug, name: plain(doc.title), score: Number.isFinite(score) && score > 0 ? score : null, price: Number.isFinite(price) && price > 0 ? price : null, category: String(r.category || ""), brand: String(r.brand || r.producer || ""), reviewer: String(r.reviewer || doc.byline || ""), issue: String(r.issue || meta.issue_label || ""), note: plain(doc.body_html || doc.excerpt || ""), image: heroOf(doc), published: docDates(doc).published, day: docDates(doc).day, noindex: isNoIndex(doc) };
}

export function ratingJsonLd(v: RatingView, origin: string): unknown[] {
  const canonical = `${origin}${BASE}/${v.slug}`;
  const review: Record<string, unknown> = {
    "@type": "Review",
    name: `${v.name} rating`,
    reviewRating: v.score ? { "@type": "Rating", ratingValue: v.score, bestRating: 100, worstRating: 0 } : undefined,
    author: v.reviewer ? { "@type": "Person", name: v.reviewer } : { "@type": "Organization", name: PUBLISHER },
    publisher: publisher(origin),
    datePublished: v.published ?? undefined,
    reviewBody: v.note || undefined,
    url: canonical,
  };
  const product = {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${canonical}#product`,
    name: v.name,
    image: v.image ? [v.image] : undefined,
    description: v.note ? clip(v.note, 300) : undefined,
    brand: v.brand ? { "@type": "Brand", name: v.brand } : undefined,
    category: v.category || undefined,
    review,
  };
  const crumbs = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: PUBLISHER, item: `${origin}${BASE}/` },
    { "@type": "ListItem", position: 2, name: "Ratings", item: `${origin}${BASE}/finder.html` },
    { "@type": "ListItem", position: 3, name: v.name, item: canonical },
  ] };
  return [product, crumbs];
}

export function renderRating(templateHtml: string, v: RatingView, origin: string): string {
  const canonical = `${origin}${BASE}/${v.slug}`;
  const title = v.score ? `${v.name}: ${v.score} points` : v.name;
  const description = clip([v.score ? `${v.name} scored ${v.score} points from Whisky Advocate` : v.name, v.category ? `${v.category}` : "", v.price ? `$${v.price}` : "", v.note].filter(Boolean).join(". ").replace(/\.\./g, "."), 300);
  let html = head(templateHtml, `${title} | ${PUBLISHER} Rating`, [
    commonTags({ title, description, canonical, image: v.image, type: "article", noindex: v.noindex, origin }),
    ...ratingJsonLd(v, origin).map(jsonLd),
  ].join("\n"));
  html = fill(html, "kicker", esc(["Rating", v.category].filter(Boolean).join(" · ")));
  html = fill(html, "name", esc(v.name));
  if (v.score) { html = fill(html, "score", String(v.score)); html = fill(html, "badgeScore", String(v.score)); html = fill(html, "navScore", String(v.score)); }
  html = fill(html, "navName", esc(v.name));
  html = fill(html, "note", esc(v.note));
  if (v.reviewer) html = fill(html, "tasterLine", `Tasted by ${esc(v.reviewer)}`);
  if (v.day) html = fill(html, "when", `<time datetime="${esc(v.published ?? v.day)}">${esc(longDate(v.day))}</time>`);
  if (v.issue) html = fill(html, "issue", esc(v.issue));
  if (v.image) html = html.replace(/<img id="art" src="[^"]*" alt="">/, `<img id="art" src="${esc(v.image)}" alt="${esc(v.name)}">`);
  return boot(html, v.slug);
}

export function notFoundPage(origin: string, slug: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page not found | ${PUBLISHER}</title><meta name="robots" content="noindex"><link rel="stylesheet" href="${BASE}/site.css"></head><body><section class="band" style="padding-top:80px"><span class="mono">Not found</span><h1 class="d2" style="margin-top:12px">We could not find “${esc(slug)}”.</h1><p class="lede" style="margin-top:14px">It may have moved. <a href="${BASE}/stories.html">Browse the stories</a>, <a href="${BASE}/finder.html">search the ratings</a> or <a href="${origin}${BASE}/">go to the home page</a>.</p></section></body></html>`;
}
