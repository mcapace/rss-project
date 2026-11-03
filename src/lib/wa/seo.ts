import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cmsDb } from "@/lib/cms/db";
import { leadImagePath } from "@/lib/cms/lead-image";
import { sponsorship } from "@/lib/cms/sponsored";
import { onlyLive } from "./live";
import { PAGE_FILE_PATTERN, type WaSite } from "./site-host";

/**
 * Server-rendered Whisky Advocate pages for search engines and AI crawlers (2026-11-01).
 *
 * The concept site's pages are static templates that read their story or bottle from the URL hash, so every
 * story was one URL to a crawler and the text only existed after JavaScript ran. /wa/<slug> now returns the same
 * template with the content, head tags and structured data filled in on the server. Sitemaps, the Google News sitemap,
 * the feed and llms.txt read the same documents.
 *
 * Every builder takes the site ({ origin, base }) from siteFor(request) (src/lib/wa/site-host.ts): on whiskyadvocate.com
 * the pages live at the root (base ""), so the old addresses stay the canonical ones; elsewhere under /wa.
 */

export const PUBLISHER = "Whisky Advocate";
const SECTION: Record<string, string> = { News: "news", Features: "features", Insights: "features", "Whisky Life": "life", Travel: "travel", Cocktails: "cocktails", Guides: "guides" };
const SECTION_LABEL: Record<string, string> = { news: "News", features: "Features", life: "Whisky Life", travel: "Travel", cocktails: "Cocktails", guides: "Guides" };

/** The site's real sections among a story's CMS categories (which also hold "Homepage Slider", "Migration" and the like). */
export function sectionLabels(categories: unknown): string[] {
  const cats = Array.isArray(categories) ? categories.filter((c): c is string => typeof c === "string") : [];
  return [...new Set(cats.map(c => SECTION[c]).filter(Boolean).map(s => SECTION_LABEL[s]))];
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
type Meta = Record<string, unknown>;
export type WaDoc = { id: string; kind: string; slug: string; title: string; byline: string | null; excerpt: string | null; body_html: string | null; metadata: Meta | null; published_at: string | null; updated_at: string | null };

const DOC_FIELDS = "id,kind,slug,title,byline,excerpt,body_html,metadata,published_at,updated_at";

/** One published Whisky Advocate document by slug, any capitalization. */
export async function loadDoc(slug: string): Promise<WaDoc | null> {
  const clean = slug.replace(/[%_\\]/g, c => "\\" + c).slice(0, 300);
  // A scheduled story is not out until its time.
  const { data, error } = await onlyLive(cmsDb().from("cms_documents").select(DOC_FIELDS).eq("brand", "wa")).ilike("slug", clean).limit(2);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as WaDoc[];
  return rows.find(r => r.slug === slug) ?? rows[0] ?? null;
}

/**
 * Every published document of the given kinds, newest first, a page at a time (PostgREST caps a request at 1,000
 * rows). Only the metadata the sitemaps and feed read is selected, not whole documents.
 */
const LITE = "id,slug,kind,title,byline,excerpt,published_at,updated_at,legacy_dates:metadata->legacy_dates,legacy_media:metadata->legacy_media,lead_image:metadata->lead_image,sponsored:metadata->sponsored,tags:metadata->tags,seo:metadata->seo,legacy_seo:metadata->legacy_seo,ai_summary:metadata->>ai_summary,categories:metadata->categories";
export async function listDocs(kinds: string[], limit = 60000, order: "newest" | "id" = "newest"): Promise<WaDoc[]> {
  const now = Date.now();
  const toDoc = (row: Record<string, unknown>): WaDoc => {
    const { legacy_dates, legacy_media, lead_image, sponsored, tags, seo, legacy_seo, ai_summary, categories, ...rest } = row;
    return { ...(rest as unknown as WaDoc), body_html: null, metadata: { legacy_dates, legacy_media, lead_image, sponsored, tags, seo, legacy_seo, ai_summary, categories } as Meta };
  };
  // A scheduled story (published_at still ahead) is not listed until its time.
  const base = () => onlyLive(cmsDb().from("cms_documents").select(LITE).eq("brand", "wa"), now).in("kind", kinds).not("slug", "is", null);
  const out: WaDoc[] = [];
  for (let from = 0; from < limit; from += 1000) {
    // Newest-first sorts on a JSON field with no index: fine for the feed's 200 rows, too slow for a whole sitemap, which pages by id.
    // Imported stories carry the old site's date; stories published from the CMS (published_at) are read apart and merged below.
    const query = order === "newest" ? base().is("published_at", null).order("metadata->legacy_dates->>published_date", { ascending: false, nullsFirst: false }).order("id") : base().order("id");
    const { data, error } = await query.range(from, Math.min(from + 999, limit - 1));
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) out.push(toDoc(row));
    if (!data || data.length < 1000) break;
  }
  if (order !== "newest") return out;
  const { data: fresh, error } = await base().not("published_at", "is", null).order("published_at", { ascending: false }).limit(Math.min(limit, 1000));
  if (error) throw new Error(error.message);
  const merged = [...((fresh ?? []) as unknown as Record<string, unknown>[]).map(toDoc), ...out];
  const when = (doc: WaDoc) => docDates(doc).published || "";
  return merged.sort((x, y) => when(y).localeCompare(when(x))).slice(0, limit);
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

/** The lead picture's absolute URL on this site: a rating's bottle shot, else the story's re-hosted lead. Never a legacy host. */
export function heroOf(doc: Pick<WaDoc, "metadata" | "id" | "kind" | "slug">, origin: string): string {
  const meta = obj(doc.metadata);
  if (doc.kind === "rating") return obj(meta.legacy_media).thumb_file ? `${origin}/api/wa/bottle/${encodeURIComponent(doc.slug)}` : "";
  const path = leadImagePath(doc.id, meta);
  return path ? origin + path : "";
}

export function isNoIndex(doc: Pick<WaDoc, "metadata">): boolean {
  const seo = obj(obj(doc.metadata).seo);
  return seo.no_index === true || obj(obj(doc.metadata).legacy_seo).no_index === "1";
}

function authorsOf(byline: string | null): string[] {
  return (byline || "").split(/\s*,\s*|\s+and\s+|\s*&\s*/).map(s => s.trim()).filter(s => s && !/sponsor/i.test(s));
}

/** A path segment that names a file rather than a story (slugs themselves may hold dots: "...-Sells-for-2.7-million-..."). */
const FILE_EXT = /\.(?:html?|js|json|css|xml|txt|png|jpe?g|gif|webp|avif|svg|ico|mp4|pdf)$/i;

/**
 * The body as the site shows it: no scripts, and same-site links in the site's shape. Under /wa (the development host)
 * an old bare-slug link (/Some-Story) goes to /wa/Some-Story. At the root (whiskyadvocate.com) a bare slug is already
 * right, and a link stored as /wa/<x> (the link rewrite wrote that form into the bodies) becomes /<x>.
 */
export function cleanBody(html: string, base: WaSite["base"]): string {
  const out = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\s(on[a-z]+)=("[^"]*"|'[^']*')/gi, "");
  if (base === "") {
    return out.replace(/(<a\b[^>]*?\shref=")\/wa(\/[^"]*)?"/gi, (_m, a: string, rest: string | undefined) => {
      const home = /^\/(?:index\.html)?(?=[?#]|$)/i.exec(rest ?? "/");
      return home ? `${a}/${(rest ?? "/").slice(home[0].length)}"` : `${a}${rest}"`;
    });
  }
  return out.replace(/(<a\b[^>]*?\shref=")\/(?!\/)([^"/?#]+)"/gi, (m, a: string, v: string) => (v === "wa" || v === "api" || FILE_EXT.test(v) ? m : `${a}${base}/${v}"`));
}

/** Put inner HTML into the first element carrying id="<id>" (which the template leaves empty). */
function fill(html: string, id: string, inner: string): string {
  const re = new RegExp(`(<([a-z0-9]+)\\b[^>]*\\bid="${id}"[^>]*>)([\\s\\S]*?)(</\\2>)`, "i");
  return html.replace(re, (_m, open: string, _tag: string, _old: string, close: string) => open + inner + close);
}
function head(html: string, title: string, tags: string): string {
  return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`).replace(/<\/head>/i, `${tags}\n</head>`);
}
/** Tell the template which item it shows (it otherwise reads the URL hash), that links may use clean paths, and their base. */
function boot(html: string, slug: string, base: WaSite["base"]): string {
  return html.replace(/<script src="site\.js"><\/script>/, `<script>window.WA_SLUG=${JSON.stringify(slug).replace(/</g, "\\u003c")};window.WA_PATHS=true;window.WA_BASE=${JSON.stringify(base)};</script>\n<script src="site.js"></script>`);
}

const templates = new Map<string, string>();
export async function template(name: "story.html" | "bottle.html"): Promise<string> {
  const hit = templates.get(name);
  if (hit) return hit;
  const html = await readFile(path.join(process.cwd(), "public", "wa", name), "utf8");
  templates.set(name, html);
  return html;
}

function publisher({ origin, base }: WaSite) {
  return { "@type": "Organization", "@id": `${origin}${base}/#publisher`, name: PUBLISHER, url: `${origin}${base}/`, logo: { "@type": "ImageObject", url: `${origin}${base}/img/icon-192.png`, width: 192, height: 192 }, sameAs: ["https://www.instagram.com/whiskyadvocate/", "https://www.facebook.com/whiskyadvocate", "https://twitter.com/whiskyadvocate", "https://www.youtube.com/channel/UCSNVtQgcKnSqZF3qXT_aQFg"] };
}

/** Search engines show about 155 characters of a description; the tag carries the SEO description cut to fit on a word. */
export function metaDescription(text: string): string { return clip(text, 158); }

function commonTags(o: { title: string; description: string; canonical: string; image: string; type: string; noindex: boolean; site: WaSite; socialTitle?: string; socialDescription?: string; imageAlt?: string; keywords?: string[] }): string {
  const social = { title: o.socialTitle || o.title, description: o.socialDescription || o.description };
  const robots = o.noindex ? "noindex, follow" : "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";
  return [
    `<meta name="description" content="${esc(metaDescription(o.description))}">`,
    o.keywords?.length ? `<meta name="keywords" content="${esc(o.keywords.join(", "))}">` : "",
    `<link rel="canonical" href="${esc(o.canonical)}">`,
    `<meta name="robots" content="${robots}">`,
    `<meta property="og:site_name" content="${PUBLISHER}">`,
    `<meta property="og:locale" content="en_US">`,
    `<meta property="og:type" content="${o.type}">`,
    `<meta property="og:title" content="${esc(social.title)}">`,
    `<meta property="og:description" content="${esc(social.description)}">`,
    `<meta property="og:url" content="${esc(o.canonical)}">`,
    o.image ? `<meta property="og:image" content="${esc(o.image)}">` : "",
    o.image && o.imageAlt ? `<meta property="og:image:alt" content="${esc(o.imageAlt)}">` : "",
    `<meta name="twitter:card" content="${o.image ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:site" content="@whiskyadvocate">`,
    `<meta name="twitter:title" content="${esc(social.title)}">`,
    `<meta name="twitter:description" content="${esc(social.description)}">`,
    o.image ? `<meta name="twitter:image" content="${esc(o.image)}">` : "",
    `<link rel="alternate" type="application/rss+xml" title="${PUBLISHER}" href="${o.site.origin}${o.site.base}/feed.xml">`,
  ].filter(Boolean).join("\n");
}

export type StoryView = { slug: string; title: string; description: string; section: string; sectionLabel: string; authors: string[]; byline: string; published: string | null; modified: string | null; day: string | null; hero: string; tags: string[]; body: string; words: number; sponsored: boolean; sponsor: string; noindex: boolean; kind: string } & SeoFields;

/**
 * What the SEO pass (scripts/wa-seo-pass.ts) and editors write in metadata.seo, beyond title and description:
 * the search title, social copy, keywords, an answer-first summary and key facts for AI answer engines (GEO),
 * the people, places and brands the piece is about, and alt text for the lead picture.
 */
export type SeoFields = { dek?: string; seoTitle?: string; socialTitle?: string; socialDescription?: string; keywords?: string[]; summary?: string; keyFacts?: string[]; entities?: { name: string; type: string }[]; heroAlt?: string };

const ENTITY_TYPES: Record<string, string> = { person: "Person", brand: "Brand", organization: "Organization", distillery: "Organization", company: "Organization", place: "Place", product: "Product", event: "Event" };

export function seoFields(metadata: unknown): SeoFields {
  const seo = obj(obj(metadata).seo);
  const text = (value: unknown) => (typeof value === "string" ? plain(value) : "");
  const entities = (Array.isArray(seo.entities) ? seo.entities : []).map(item => obj(item)).map(item => ({ name: text(item.name), type: ENTITY_TYPES[text(item.type).toLowerCase()] ?? "Thing" })).filter(item => item.name).slice(0, 12);
  return {
    seoTitle: text(seo.title) || undefined, socialTitle: text(seo.og_title) || undefined, socialDescription: text(seo.og_description) || undefined,
    keywords: strs(seo.keywords).slice(0, 12), summary: text(seo.summary) || undefined, keyFacts: strs(seo.key_facts).map(plain).filter(Boolean).slice(0, 6),
    entities, heroAlt: text(seo.image_alt) || undefined,
  };
}

/** The page title: the search title with the publication when it fits in about 65 characters. */
export function pageTitle(title: string, suffix = PUBLISHER): string {
  return `${title} | ${suffix}`.length <= 68 ? `${title} | ${suffix}` : title;
}

export function storyView(doc: WaDoc, site: WaSite): StoryView {
  const meta = obj(doc.metadata);
  const seo = obj(meta.seo);
  const cats = strs(meta.categories);
  const tags = strs(meta.ai_tags).length ? strs(meta.ai_tags) : strs(meta.tags).filter(t => !cats.includes(t) && !/^[a-z0-9_]+$/.test(t));
  const section = cats.map(c => SECTION[c]).find(Boolean) ?? (doc.kind === "article" ? "news" : "features");
  const body = cleanBody(doc.body_html || "", site.base);
  const text = plain(body);
  const description = clip(plain(String(seo.description || doc.excerpt || meta.ai_summary || "")) || text, 300);
  // The dek readers see is the editors' line; the SEO pass keeps the one it replaced in seo.previous.
  const editors = "previous" in seo ? String(obj(seo.previous).description || "") : String(seo.description || "");
  const dek = clip(plain(String(editors || doc.excerpt || meta.ai_summary || "")), 300) || description;
  const sp = sponsorship(meta, doc.byline);
  const dates = docDates(doc);
  return { slug: doc.slug, title: plain(doc.title), description, section, sectionLabel: SECTION_LABEL[section] ?? "Stories", authors: authorsOf(doc.byline), byline: doc.byline || "", published: dates.published, modified: dates.modified, day: dates.day, hero: heroOf(doc, site.origin), tags: tags.slice(0, 12), body, words: text ? text.split(" ").length : 0, sponsored: sp.on, sponsor: sp.by, noindex: isNoIndex(doc), kind: doc.kind, dek, ...seoFields(meta) };
}

function longDate(day: string | null): string {
  if (!day) return "";
  return new Date(day + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function storyJsonLd(v: StoryView, site: WaSite): unknown[] {
  const { origin, base } = site;
  const canonical = `${origin}${base}/${v.slug}`;
  const isArticle = v.kind === "article";
  const article: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": v.sponsored ? "AdvertiserContentArticle" : isArticle ? "NewsArticle" : "Article",
    "@id": `${canonical}#article`,
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    url: canonical,
    headline: clip(v.title, 110),
    description: metaDescription(v.description),
    abstract: v.summary || undefined,
    image: v.hero ? [v.hero] : undefined,
    datePublished: v.published ?? undefined,
    dateModified: v.modified ?? v.published ?? undefined,
    author: v.authors.length ? v.authors.map(name => ({ "@type": "Person", name, url: `${origin}${base}/stories.html#by=${encodeURIComponent(name)}` })) : { "@type": "Organization", name: PUBLISHER, url: `${origin}${base}/` },
    publisher: publisher(site),
    articleSection: v.sectionLabel,
    keywords: [...new Set([...(v.keywords ?? []), ...v.tags])].join(", ") || undefined,
    about: v.entities?.length ? v.entities.slice(0, 4).map(e => ({ "@type": e.type, name: e.name })) : undefined,
    mentions: v.entities && v.entities.length > 4 ? v.entities.slice(4).map(e => ({ "@type": e.type, name: e.name })) : undefined,
    wordCount: v.words || undefined,
    inLanguage: "en-US",
    isAccessibleForFree: true,
  };
  if (v.sponsored) article.sponsor = { "@type": "Organization", name: v.sponsor || "Advertiser" };
  const crumbs = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: PUBLISHER, item: `${origin}${base}/` },
    { "@type": "ListItem", position: 2, name: v.sectionLabel, item: `${origin}${base}/stories.html#${v.section}` },
    { "@type": "ListItem", position: 3, name: v.title, item: canonical },
  ] };
  return [article, crumbs];
}

export function renderStory(templateHtml: string, v: StoryView, site: WaSite): string {
  const { base } = site;
  const canonical = `${site.origin}${base}/${v.slug}`;
  let html = head(templateHtml, pageTitle(v.seoTitle || v.title), [
    commonTags({ title: v.seoTitle || v.title, description: v.description, canonical, image: v.hero, type: "article", noindex: v.noindex, site, socialTitle: v.socialTitle || v.title, socialDescription: v.socialDescription, imageAlt: v.heroAlt, keywords: v.keywords }),
    v.published ? `<meta property="article:published_time" content="${esc(v.published)}">` : "",
    v.modified ? `<meta property="article:modified_time" content="${esc(v.modified)}">` : "",
    `<meta property="article:section" content="${esc(v.sectionLabel)}">`,
    ...v.tags.map(t => `<meta property="article:tag" content="${esc(t)}">`),
    ...v.authors.map(a => `<meta property="article:author" content="${esc(a)}">`),
    v.authors.length ? `<meta name="author" content="${esc(v.authors.join(", "))}">` : "",
    ...storyJsonLd(v, site).map(jsonLd),
  ].filter(Boolean).join("\n"));
  html = fill(html, "crumbs", `<a href="${base}/stories.html">Stories</a> › <a href="${base}/stories.html#${v.section}">${esc(v.sectionLabel)}</a>`);
  html = fill(html, "kicker", (v.sponsored ? '<span class="sp-chip">Sponsored</span>' : "") + esc(v.sectionLabel) + (v.tags[0] && !/sponsor/i.test(v.tags[0]) ? " · " + esc(v.tags[0]) : ""));
  html = fill(html, "title", esc(v.title));
  html = fill(html, "dek", esc(v.dek || v.description));
  const date = v.day ? `<time datetime="${esc(v.published ?? v.day)}">${esc(longDate(v.day))}</time>` : "";
  const who = v.sponsored ? `<span>${v.sponsor ? `Sponsored by <strong>${esc(v.sponsor)}</strong>` : "<strong>Sponsored content</strong>"}</span>` : v.authors.length ? `<span>By ${v.authors.map(a => `<a href="${base}/stories.html#by=${encodeURIComponent(a)}" rel="author"><strong>${esc(a)}</strong></a>`).join(", ")}</span>` : "";
  html = fill(html, "byline", `${who}<span>${date}</span>${v.words ? `<span>${Math.max(1, Math.round(v.words / 230))} minute read</span>` : ""}`);
  if (v.hero) html = html.replace(/<figure class="figure story-hero" id="hero" hidden><img src="" alt="">/, `<figure class="figure story-hero" id="hero"><img src="${esc(v.hero)}" alt="${esc(v.heroAlt || v.title)}" fetchpriority="high">`);
  const disclosure = v.sponsored ? `<p class="sp-note" role="note">This is paid content, produced with ${esc(v.sponsor || "an advertiser")}. It is not part of Whisky Advocate&rsquo;s editorial coverage, and it does not affect our ratings.</p>` : "";
  html = fill(html, "prose", disclosure + v.body);
  return boot(html, v.slug, base);
}

export type RatingView = { slug: string; name: string; score: number | null; price: number | null; category: string; brand: string; reviewer: string; issue: string; note: string; image: string; published: string | null; day: string | null; noindex: boolean; seoDescription?: string } & SeoFields;

export function ratingView(doc: WaDoc, site: WaSite): RatingView {
  const meta = obj(doc.metadata);
  const r = obj(meta.rating);
  const score = Number(r.score);
  const price = Number(r.price);
  return { slug: doc.slug, name: plain(doc.title), score: Number.isFinite(score) && score > 0 ? score : null, price: Number.isFinite(price) && price > 0 ? price : null, category: String(r.category || ""), brand: String(r.brand || r.producer || ""), reviewer: String(r.reviewer || doc.byline || ""), issue: String(r.issue || meta.issue_label || ""), note: plain(doc.body_html || doc.excerpt || ""), image: heroOf(doc, site.origin), published: docDates(doc).published, day: docDates(doc).day, noindex: isNoIndex(doc), seoDescription: typeof obj(meta.seo).description === "string" ? plain(String(obj(meta.seo).description)) || undefined : undefined, ...seoFields(meta) };
}

export function ratingJsonLd(v: RatingView, site: WaSite): unknown[] {
  const { origin, base } = site;
  const canonical = `${origin}${base}/${v.slug}`;
  const review: Record<string, unknown> = {
    "@type": "Review",
    name: `${v.name} rating`,
    reviewRating: v.score ? { "@type": "Rating", ratingValue: v.score, bestRating: 100, worstRating: 0 } : undefined,
    author: v.reviewer ? { "@type": "Person", name: v.reviewer } : { "@type": "Organization", name: PUBLISHER },
    publisher: publisher(site),
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
    { "@type": "ListItem", position: 1, name: PUBLISHER, item: `${origin}${base}/` },
    { "@type": "ListItem", position: 2, name: "Ratings", item: `${origin}${base}/finder.html` },
    { "@type": "ListItem", position: 3, name: v.name, item: canonical },
  ] };
  return [product, crumbs];
}

export function renderRating(templateHtml: string, v: RatingView, site: WaSite): string {
  const canonical = `${site.origin}${site.base}/${v.slug}`;
  const title = v.seoTitle || (v.score ? `${v.name}: ${v.score} points` : v.name);
  const description = v.seoDescription || clip([v.score ? `${v.name} scored ${v.score} points from Whisky Advocate` : v.name, v.category ? `${v.category}` : "", v.price ? `$${v.price}` : "", v.note].filter(Boolean).join(". ").replace(/\.\./g, "."), 300);
  let html = head(templateHtml, pageTitle(title, `${PUBLISHER} Rating`), [
    commonTags({ title, description, canonical, image: v.image, type: "article", noindex: v.noindex, site, imageAlt: v.heroAlt || (v.image ? `Bottle of ${v.name}` : undefined), keywords: v.keywords }),
    ...ratingJsonLd(v, site).map(jsonLd),
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
  return boot(html, v.slug, site.base);
}

export function notFoundPage(site: WaSite, slug: string): string {
  const { origin, base } = site;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page not found | ${PUBLISHER}</title><meta name="robots" content="noindex"><link rel="stylesheet" href="${base}/site.css"></head><body><section class="band" style="padding-top:80px"><span class="mono">Not found</span><h1 class="d2" style="margin-top:12px">We could not find “${esc(slug)}”.</h1><p class="lede" style="margin-top:14px">It may have moved. <a href="${base}/stories.html">Browse the stories</a>, <a href="${base}/finder.html">search the ratings</a> or <a href="${origin}${base}/">go to the home page</a>.</p></section></body></html>`;
}

/** A site page's file name in metadata.page_file: a top-level public/wa page such as "water.html", else null. */
export function sitePageFile(metadata: unknown): string | null {
  const value = obj(metadata).page_file;
  return typeof value === "string" && PAGE_FILE_PATTERN.test(value.trim()) ? value.trim() : null;
}

/**
 * "Served by a site page": a story whose metadata.page_file names a public/wa page (the water tool) is answered with
 * that page at the story's own URL. The page keeps its body; its head gets the story's tags as the story page would have
 * them (title, description, canonical and og:url for this host, robots with the story's noindex, og/twitter card and
 * picture, the article JSON-LD), so the indexed URL keeps its share image and structured data, and window.WA_BASE so
 * the page's links take the host's shape. Null when the file is not a valid page on disk (the story renders as usual).
 */
export async function sitePage(file: string | null, v: StoryView, site: WaSite): Promise<string | null> {
  if (!file || !PAGE_FILE_PATTERN.test(file)) return null;
  let html: string;
  try { html = await readFile(path.join(process.cwd(), "public", "wa", file), "utf8"); } catch { return null; }
  const canonical = `${site.origin}${site.base}/${v.slug}`;
  // The page's own copies of the tags the story sets are dropped, so each appears once.
  html = html
    .replace(/[ \t]*<link\b[^>]*\brel=["'](?:canonical|alternate)["'][^>]*>\n?/gi, "")
    .replace(/[ \t]*<meta\b[^>]*\b(?:name|property)=["'](?:description|keywords|robots|author|og:[^"']*|twitter:[^"']*|article:[^"']*)["'][^>]*>\n?/gi, "");
  html = head(html, pageTitle(v.seoTitle || v.title), [
    commonTags({ title: v.seoTitle || v.title, description: v.description, canonical, image: v.hero, type: "article", noindex: v.noindex, site, socialTitle: v.socialTitle || v.title, socialDescription: v.socialDescription, imageAlt: v.heroAlt, keywords: v.keywords }),
    v.published ? `<meta property="article:published_time" content="${esc(v.published)}">` : "",
    v.modified ? `<meta property="article:modified_time" content="${esc(v.modified)}">` : "",
    ...storyJsonLd(v, site).map(jsonLd),
    `<script>window.WA_BASE=${JSON.stringify(site.base)};</script>`,
  ].filter(Boolean).join("\n"));
  // The story itself follows the page, so the text that earned the URL stays on it; links on the page to the story's
  // own address (the tool's credit line) point down to it instead of at the page itself.
  html = selfLinksToSource(html, v.slug);
  // The tool's own words and pointers apply only when the page is the water tool; any other page gets a plain section.
  const tool = /\bid="wtFind"/.test(html);
  const section = sourceSection(v, site, tool ? { water: "#wtFind", perfect: /\bid="wtPerfect"/.test(html) ? "#wtPerfect" : "#wtFind" } : null);
  const at = html.search(/<section class="nl-band"|<footer\b/);
  return at >= 0 ? html.slice(0, at) + section + "\n" + html.slice(at) : html.replace(/<\/body>/i, section + "\n</body>");
}

/** Links whose target is the story's own address (relative, /wa/, or on whiskyadvocate.com) become "#source". */
function selfLinksToSource(html: string, slug: string): string {
  const own = slug.toLowerCase();
  return html.replace(/<a\b([^>]*?)\bhref=(["'])([^"']*)\2([^>]*)>/gi, (tag, before: string, _q: string, href: string, after: string) => {
    const path = href.replace(/^https?:\/\/(?:www\.)?whiskyadvocate\.com/i, "").replace(/[?#].*$/, "").replace(/^\/?(?:wa\/)?/i, "").replace(/\/$/, "");
    if (path.toLowerCase() !== own) return tag;
    const attrs = (before + after).replace(/\s*\btarget=(["'])[^"']*\1/gi, "").replace(/\s*\brel=(["'])[^"']*\1/gi, "");
    return `<a${attrs.replace(/\s+$/, "")} href="#source">`;
  });
}

export type ToolPointers = { water: string; perfect: string };

/**
 * The old site's inline widgets (the water story's two calculators: bare inputs and buttons with no script behind them)
 * are dropped from the copy under a site page. On the water tool each one leaves a pointer to the part of the tool that
 * does its job (a block whose id or class names the perfect proof points to "Find your perfect proof", the others to
 * the bottle search); a widget inside a sentence leaves an inline pointer so the markup stays valid. With no pointers
 * (another site page) the controls are simply removed.
 */
export function withoutLegacyControls(html: string, pointers: ToolPointers | null = { water: "#wtFind", perfect: "#wtFind" }): string {
  const ANY = "\u0000", PERFECT = "\u0001";
  let out = html
    .replace(/<(button|select|textarea)\b[^>]*>[^<]*(?:<(?!\/?\1\b)[^<]*)*<\/\1>/gi, ANY)
    .replace(/<input\b[^>]*>/gi, ANY);
  if (!out.includes(ANY)) return html;
  for (let i = 0; i < 12; i++) {
    const next = out.replace(/<(div|form|span|p|label|fieldset)\b([^>]*)>([ \t\r\n\u0000\u0001]*)<\/\1>/gi, (tag, _el: string, attrs: string, inner: string) =>
      /[\u0000\u0001]/.test(inner) ? (/perfect/i.test(attrs) || inner.includes(PERFECT) ? PERFECT : ANY) : tag);
    if (next === out) break;
    out = next;
  }
  return out.replace(/[ \t\r\n\u0000\u0001]*[\u0000\u0001][ \t\r\n\u0000\u0001]*/g, (run, at: number, all: string) => {
    const before = all.slice(0, at).trimEnd(), after = all.slice(at + run.length).trimStart();
    const block = (before === "" || before.endsWith(">")) && (after === "" || after.startsWith("<"));
    if (!pointers) return block ? "\n" : " ";
    const perfect = run.includes(PERFECT);
    const link = `<a href="${perfect ? pointers.perfect : pointers.water}">${perfect ? "Use Find your perfect proof on this page." : "Use the calculator at the top of this page."}</a>`;
    return block ? `\n<p class="muted">${link}</p>\n` : ` <span class="muted">${link}</span> `;
  });
}

/** The story under a site page: kicker, headline, byline and the cleaned body in the story page's prose style. */
function sourceSection(v: StoryView, site: WaSite, pointers: ToolPointers | null): string {
  const date = v.day ? `<span><time datetime="${esc(v.published ?? v.day)}">${esc(longDate(v.day))}</time></span>` : "";
  // A sponsored story keeps its label and disclosure here exactly as renderStory shows them.
  const who = v.sponsored ? `<span>${v.sponsor ? `Sponsored by <strong>${esc(v.sponsor)}</strong>` : "<strong>Sponsored content</strong>"}</span>` : v.authors.length ? `<span>By ${v.authors.map(a => `<a href="${site.base}/stories.html#by=${encodeURIComponent(a)}" rel="author"><strong>${esc(a)}</strong></a>`).join(", ")}</span>` : "";
  const kicker = (v.sponsored ? '<span class="sp-chip">Sponsored</span>' : "") + (pointers ? "The guide behind the tool" : esc(v.sectionLabel));
  const disclosure = v.sponsored ? `<p class="sp-note" role="note">This is paid content, produced with ${esc(v.sponsor || "an advertiser")}. It is not part of Whisky Advocate&rsquo;s editorial coverage, and it does not affect our ratings.</p>` : "";
  return `<section class="band wa-source" id="source" aria-labelledby="sourceTitle">
  <div class="read-frame">
    <div style="max-width: 980px">
      <span class="tag">${kicker}</span>
      <h2 class="d2" style="margin-top: 12px" id="sourceTitle">${esc(v.title)}</h2>
      ${v.dek ? `<p class="lede" style="margin-top: 14px; max-width: 60ch">${esc(v.dek)}</p>` : ""}
      <p class="byline" style="margin-top: 18px">${who}${date}</p>
    </div>
    <div class="prose" style="margin-top: 28px">${disclosure}${withoutLegacyControls(v.body, pointers)}</div>
  </div>
</section>`;
}
