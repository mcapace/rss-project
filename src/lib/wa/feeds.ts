import "server-only";
import { sponsorship } from "@/lib/cms/sponsored";
import { BASE, PUBLISHER, docDates, heroOf, isNoIndex, listDocs, xmlEsc, type WaDoc } from "./seo";

/** Sitemaps, the Google News sitemap, the RSS feed and llms.txt for the Whisky Advocate site (2026-11-01). */

export const STORY_KINDS = ["article", "legacy_record", "page", "collection_entry", "directory_entry"];
export const XML = { "Content-Type": "application/xml; charset=utf-8" };
export const TEXT = { "Content-Type": "text/plain; charset=utf-8" };
export const HOURLY = "public, s-maxage=3600, stale-while-revalidate=86400";
export const NEWS_CACHE = "public, s-maxage=300, stale-while-revalidate=900";

/** The site's own section pages, in the sitemap beside the stories and ratings. */
export const SECTION_PAGES = ["", "stories.html", "stories.html#news", "finder.html", "guides.html", "cocktails.html", "travel.html", "top20.html", "video.html", "producers.html", "ninety.html", "tools.html", "newsletter.html", "industry.html", "retailers.html", "retailer-club.html", "about.html", "contact.html", "app.html"].filter(p => !p.includes("#"));

export const indexable = (d: WaDoc) => !isNoIndex(d);
export const isSponsored = (d: WaDoc) => sponsorship(d.metadata, d.byline).on;

export async function storyDocs(): Promise<WaDoc[]> { return (await listDocs(STORY_KINDS, 60000, "id")).filter(indexable); }
export async function ratingDocs(): Promise<WaDoc[]> { return (await listDocs(["rating"], 60000, "id")).filter(indexable); }

export function urlEntry(loc: string, lastmod: string | null, extra = ""): string {
  return `<url><loc>${xmlEsc(loc)}</loc>${lastmod ? `<lastmod>${xmlEsc(lastmod)}</lastmod>` : ""}${extra}</url>`;
}

export function storyEntry(origin: string, d: WaDoc): string {
  const dates = docDates(d);
  const hero = heroOf(d);
  return urlEntry(`${origin}${BASE}/${encodeURIComponent(d.slug)}`, dates.modified ?? dates.published, hero ? `<image:image><image:loc>${xmlEsc(hero)}</image:loc></image:image>` : "");
}

export function urlset(entries: string[], ns = ""): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${ns}>\n${entries.join("\n")}\n</urlset>\n`;
}
export const IMAGE_NS = ` xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"`;
export const NEWS_NS = ` xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"`;

/** Google News: editorial stories from the last two days, with the publication named Whisky Advocate. Paid content is left out. */
export function newsEntry(origin: string, d: WaDoc): string {
  const dates = docDates(d);
  const hero = heroOf(d);
  return `<url><loc>${xmlEsc(`${origin}${BASE}/${encodeURIComponent(d.slug)}`)}</loc><news:news><news:publication><news:name>${PUBLISHER}</news:name><news:language>en</news:language></news:publication><news:publication_date>${xmlEsc(dates.published ?? "")}</news:publication_date><news:title>${xmlEsc(d.title)}</news:title></news:news>${hero ? `<image:image><image:loc>${xmlEsc(hero)}</image:loc></image:image>` : ""}</url>`;
}

export function rfc822(iso: string | null): string { return iso ? new Date(iso).toUTCString() : new Date().toUTCString(); }

/** The newest editorial stories, enough to cover the news window and the feed. */
export async function listDocsForNews(): Promise<WaDoc[]> { return (await listDocs(["article"], 200)).filter(indexable); }
