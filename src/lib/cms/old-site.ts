/**
 * Reading whiskyadvocate.com (the Morweb site) while it is still the live site: its RSS feed, sitemaps and listing pages
 * say what it has published, and a post's own page carries everything the CMS keeps for it. Used by
 * scripts/wa-sync-old-site.ts to bring over what was published after the archive import.
 */

export const OLD_SITE = "https://whiskyadvocate.com";

const decode = (s: string) => s
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "’")
  .replace(/&ldquo;|&rdquo;/g, '"').replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&hellip;/g, "…")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
const text = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const first = (html: string, re: RegExp) => re.exec(html)?.[1] ?? "";

/** A site path ("/heaven-hill-phoenix-bourbon-review") from an absolute or relative link on the old site; null for other hosts. */
export function sitePath(href: string): string | null {
  try {
    const url = new URL(href, OLD_SITE);
    if (url.hostname.replace(/^www\./, "") !== "whiskyadvocate.com") return null;
    const path = decodeURIComponent(url.pathname).replace(/\/+$/, "");
    return path || "/";
  } catch { return null; }
}

export type FeedItem = { path: string; title: string; published: string };

/** The RSS feed (/call/blogs/rss/): the newest posts, newest first. */
export function parseFeed(xml: string): FeedItem[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap(([, item]) => {
    const path = sitePath(first(item, /<link>\s*([^<]+?)\s*<\/link>/));
    const title = text(first(item, /<title>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/title>/));
    const date = new Date(first(item, /<pubDate>([^<]+)<\/pubDate>/));
    return path ? [{ path, title, published: isNaN(date.getTime()) ? "" : date.toISOString() }] : [];
  });
}

/** Every <loc> in a sitemap or sitemap index, as site paths. */
export function parseSitemap(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map(m => sitePath(decode(m[1]).trim())).filter((p): p is string => !!p);
}

/** Post links on a listing page (home, a section, a tag): single-segment paths long enough to be a story or rating. */
export function listingLinks(html: string): string[] {
  const out = new Set<string>();
  for (const [, href] of html.matchAll(/href="([^"#?]+)"/g)) {
    const path = sitePath(href);
    if (path && /^\/[A-Za-z0-9][A-Za-z0-9._-]{11,}$/.test(path) && !/\.(css|js|png|jpe?g|svg|ico|xml)$/i.test(path)) out.add(path);
  }
  return [...out];
}

/** The inner HTML of the first element whose opening tag matches `open`, balancing nested elements of the same tag. */
export function innerBlock(html: string, open: RegExp, tag = "div"): string {
  const m = open.exec(html);
  if (!m) return "";
  const start = m.index + m[0].length;
  const tags = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  tags.lastIndex = start;
  let depth = 1;
  for (let t = tags.exec(html); t; t = tags.exec(html)) {
    depth += t[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, t.index);
  }
  return "";
}

/** Old-site markup made portable: no scripts, styles, comments or layout attributes; images and links absolute, image sizing parameters dropped. */
export function cleanBody(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, "")
    .replace(/\s(?:data-crop-sn|class|id|style|onclick)="[^"]*"/gi, "")
    .replace(/(<img\b[^>]*\ssrc=")([^"]+)"/gi, (_, pre, src) => `${pre}${absolute(src.replace(/\?resize=[^"&]*/, ""))}"`)
    .replace(/(<a\b[^>]*\shref=")(\/[^"]*)"/gi, (_, pre, href) => `${pre}${OLD_SITE}${href}"`)
    .replace(/<p>\s*(?:&nbsp;)?\s*<\/p>/gi, "")
    .trim();
}
const absolute = (src: string) => (src.startsWith("/") ? OLD_SITE + src : src);

/** "November 10, 2026" (the post's byline date) as 2026-11-10. */
export function isoDate(label: string): string {
  const m = /([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})/.exec(label);
  if (!m) return "";
  const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].indexOf(m[1]);
  return month < 0 ? "" : `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

export type OldPost = {
  path: string; postId: string; kind: "article" | "rating";
  title: string; dek: string; date: string; authors: string[]; description: string; keywords: string[]; tags: string[];
  hero: string; heroCaption: string; body: string;
  rating: { score: number | null; price: number | null; priceRaw: string; issue: string; reviewer: string; category: string } | null;
};

/** One post page on the old site: a story (headline, dek, byline date, authors, lead photograph, body) or a rating (score, price, issue, reviewer, category, note). */
export function parsePost(path: string, html: string): OldPost | null {
  const postId = first(html, /BlogsPostID\s*=\s*(\d+)/);
  if (!postId) return null;
  const meta = (name: string) => decode(first(html, new RegExp(`<meta (?:name|property)="${name}" content="([^"]*)"`)));
  const stats = first(html, /<div class="postDetailsStats">\s*<p>([\s\S]*?)<\/p>/);
  const body = cleanBody(innerBlock(html, /<div class="postDetailsContent[^"]*"[^>]*>/));
  const keywords = meta("keywords").split(",").map(k => k.trim()).filter(Boolean);
  if (stats) {
    const field = (label: string) => text(first(stats, new RegExp(`${label}:\\s*([\\s\\S]*?)(?:<span>●|$)`)));
    const priceRaw = field("Price");
    const score = Number(first(html, /<h3>\s*(\d{2,3})\s*<\/h3>\s*<p>Score<\/p>/));
    return {
      path, postId, kind: "rating",
      title: text(first(html, /<div class="postDetailsTitle">\s*<h1>([\s\S]*?)<\/h1>/)) || meta("og:title"),
      dek: "", date: "", authors: [], description: meta("description"), keywords, tags: [], hero: "", heroCaption: "", body,
      rating: { score: score >= 50 && score <= 100 ? score : null, price: /^\d+(?:\.\d+)?$/.test(priceRaw) ? Number(priceRaw) : null, priceRaw, issue: field("Issue"), reviewer: field("Reviewer"), category: field("Category") },
    };
  }
  const byline = first(html, /<p class="postsDetailsDate">([\s\S]*?)<\/p>/);
  const authors = [...byline.matchAll(/<a href="\/tag\/[^"]+">(?:<span[^>]*>)?([^<]+)(?:<\/span>)?<\/a>/g)].map(m => text(m[1])).filter(Boolean);
  const hero = first(html, /<img class="postDetailsBannerImg" src="([^"?]+)/) || meta("og:image").replace(/^http:/, "https:");
  return {
    path, postId, kind: "article",
    title: text(first(html, /<h1 class="postDetailsTitle">([\s\S]*?)<\/h1>/)) || meta("og:title"),
    dek: text(innerBlock(html, /<p class="postDetailsSubheader">/, "p")),
    date: isoDate(text(byline.split(/–/)[0] ?? "")),
    authors, description: meta("description"), keywords,
    tags: [...new Set([...html.matchAll(/<span><a href="\/tag\/[^"]+">([^<]+)<\/a><\/span>/g)].map(m => text(m[1])))],
    hero: /^https?:\/\/[^/]+\/?$/.test(hero) ? "" : absolute(hero),
    heroCaption: text(first(html, /<div class="postDetailsBannerCaption">\s*<p[^>]*>([\s\S]*?)<\/p>/)),
    body, rating: null,
  };
}
