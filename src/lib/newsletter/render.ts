/**
 * Newsletter rendering: the same single-column, table-based template the
 * editor's email preview shows, produced server-side for the ESP. Pure so it
 * can be tested and reused by the preview.
 */
import type { CmsBrand } from "@/lib/cms/types";
import { replaceVideoEmbeds } from "@/lib/cms/video";

export const BRAND_INK: Record<CmsBrand, string> = { wa: "#3d5a80", ws: "#6f1d2b", ca: "#b45309", mw: "#1b4332" };
export const BRAND_NAMES: Record<CmsBrand, string> = { wa: "Whisky Advocate", ws: "Wine Spectator", ca: "Cigar Aficionado", mw: "Market Watch" };
export const NEWSLETTER_KINDS = ["daily_alert", "weekly", "breaking", "custom"] as const;
export type NewsletterKind = (typeof NEWSLETTER_KINDS)[number];
export const KIND_LABELS: Record<NewsletterKind, string> = { daily_alert: "Daily Alert", weekly: "Weekly", breaking: "Breaking", custom: "Custom send" };

export type NewsletterInput = {
  brand: CmsBrand; kind: NewsletterKind; subject: string; preheader?: string | null;
  title: string; byline: string; excerpt: string; section: string; html: string; url: string | null;
};

const textSafe = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * An email has no base URL, so every link and picture in the body must be absolute. Same-site paths are made absolute
 * against the site's origin in that site's shape: at the root (base "", whiskyadvocate.com once it points here) a stored
 * /wa/<x> link is /<x>; under /wa (the development host, until the cutover) /wa links stay and a relative link is /wa/<x>.
 */
export function absoluteEmailLinks(html: string, origin: string, base: "" | "/wa" = ""): string {
  const site = origin.replace(/\/+$/, "");
  return html.replace(/(\s(?:href|src)=)(["'])([^"']*)\2/gi, (match, attr: string, quote: string, value: string) => {
    const v = value.trim();
    if (!v || v.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(v)) return match;
    if (v.startsWith("//")) return `${attr}${quote}https:${v}${quote}`;
    let path = v.startsWith("/") ? v : `${base}/${v.replace(/^\.\//, "")}`;
    if (!base && /^\/wa(?=[/?#]|$)/i.test(path)) path = path.replace(/^\/wa(?:\/(?:index\.html)?)?(?=[?#]|$)/i, "/").replace(/^\/wa\//i, "/");
    return `${attr}${quote}${site}${path}${quote}`;
  });
}

/**
 * Where a Whisky Advocate email sends readers. Once whiskyadvocate.com points at this app (WA_ROOT_LIVE, `live`), the
 * story's current slug at the root origin, with the body's links in the root form. Before that the domain is still the
 * old site, which has none of the stories made in the new CMS, so the email keeps the story's public URL, else the
 * development host's /wa address (PUBLIC_SITE_URL), and the body's links stay on that host.
 */
export function waEmailTarget(doc: { slug: string | null; public_url: string | null; path: string | null }, env: { live: boolean; rootOrigin: string; siteUrl: string }): { url: string | null; origin: string | null; base: "" | "/wa" } {
  const siteUrl = env.siteUrl.replace(/\/+$/, "");
  if (env.live) return { url: doc.slug ? `${env.rootOrigin.replace(/\/+$/, "")}/${encodeURIComponent(doc.slug)}` : null, origin: env.rootOrigin, base: "" };
  return { url: doc.public_url ?? (siteUrl && doc.path ? `${siteUrl}${doc.path}` : null), origin: siteUrl || null, base: "/wa" };
}

/** The email keeps the lede and the first section; the rest stays on the site. */
export function newsletterBody(html: string): { body: string; truncated: boolean } {
  const parts = html.split(/(?=<h2)/i);
  const body = parts.slice(0, 2).join("");
  return { body, truncated: body.length < html.length };
}

/**
 * Email cannot play a video, so a video figure stays a link: for YouTube the video's still, linked to the video, above a
 * "Watch on YouTube" link and the caption; for Vimeo (no still without an API call) the link alone. Never an iframe.
 */
export function emailVideos(html: string, ink: string = BRAND_INK.wa, title = ""): string {
  return replaceVideoEmbeds(html, video => {
    const provider = video.provider === "youtube" ? "YouTube" : "Vimeo";
    const still = video.thumb ? `<a class="video-still" href="${escape(video.href)}" style="display:block;padding:0;background:none;text-decoration:none"><img src="${escape(video.thumb)}" alt="${escape(video.caption || title ? `Play video: ${video.caption || title}` : "Play video")}" width="552" style="display:block;width:100%;max-width:552px;height:auto;border:0"></a>` : "";
    const link = `<a href="${escape(video.href)}" style="display:block;padding:${still ? "10px 0 0" : "36px 16px"};text-align:center;background:${still ? "none" : "#f4f4f5"};color:${ink};font:700 14px Arial,sans-serif;text-decoration:none">Watch on ${provider}</a>`;
    return `<figure data-embed="video" style="margin:20px 0">${still}${link}${video.caption ? `<figcaption>${escape(video.caption)}</figcaption>` : ""}</figure>`;
  });
}

export function renderNewsletterHtml(input: NewsletterInput): string {
  const ink = BRAND_INK[input.brand];
  const name = BRAND_NAMES[input.brand];
  const parts = newsletterBody(input.html);
  const body = emailVideos(parts.body, ink, input.title), truncated = parts.truncated;
  const cta = input.url ? `<a class="cta" href="${escape(input.url)}" style="display:block;margin:28px 0 0;padding:14px;text-align:center;background:${ink};color:#fff;font:700 14px Arial,sans-serif;text-decoration:none">Read the full story</a>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(input.subject)}</title>
<style>body{margin:0;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif}.wrap{width:100%;max-width:600px;margin:0 auto;background:#fff}.bar{background:${ink};color:#fff;padding:18px 24px;font:700 14px/1 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase}.inner{padding:24px}
.kicker{font:700 11px/1.4 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:${ink};margin:0}h1{font:700 26px/1.2 Arial,sans-serif;margin:8px 0 10px;color:#111}.dek{font:16px/1.5 Georgia,serif;color:#444;margin:0 0 12px}.byline{font:12px/1.5 Arial,sans-serif;color:#777;margin:0 0 20px}
.body{font:16px/1.65 Georgia,serif;color:#222}.body h2{font:700 20px/1.3 Arial,sans-serif;margin:24px 0 8px}.body img{max-width:100%;height:auto}.body figure{margin:20px 0}.body figcaption{font:12px/1.5 Arial,sans-serif;color:#777}
.body figure[data-embed] a{display:block;padding:36px 16px;text-align:center;background:#f4f4f5;color:${ink};font:14px Arial,sans-serif;text-decoration:none}
.foot{padding:18px 24px;font:11px/1.6 Arial,sans-serif;color:#888;border-top:1px solid #eee}.preheader{display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden}</style></head><body>
${input.preheader ? `<div class="preheader">${escape(input.preheader)}</div>` : ""}
<table role="presentation" class="wrap" cellpadding="0" cellspacing="0" width="100%"><tr><td class="bar">${escape(name)} · ${escape(KIND_LABELS[input.kind])}</td></tr>
<tr><td class="inner">${input.section ? `<p class="kicker">${escape(input.section)}</p>` : ""}<h1>${escape(input.title || "Untitled")}</h1>${input.excerpt ? `<p class="dek">${escape(input.excerpt)}</p>` : ""}${input.byline ? `<p class="byline">By ${escape(input.byline)}</p>` : ""}<div class="body">${body}${truncated ? "<p><em>Continue reading on the site…</em></p>" : ""}</div>${cta}</td></tr>
<tr><td class="foot">You are receiving this because you subscribe to ${escape(name)}. {{${"${custom_attribute.${unsubscribe_url}}"}}} · M. Shanken Communications</td></tr></table>
</body></html>`;
}

export function renderNewsletterText(input: NewsletterInput): string {
  // A video has no words of its own in plain text, so its caption and address stand in for it.
  const body = replaceVideoEmbeds(newsletterBody(input.html).body, video => `<p>${textSafe(video.caption ? `${video.caption}: ` : "")}Watch the video at ${textSafe(video.href)}</p>`);
  const text = body.replace(/<\/(p|h2|h3|li|blockquote)>/gi, "\n\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n{3,}/g, "\n\n").trim();
  return [`${BRAND_NAMES[input.brand]} · ${KIND_LABELS[input.kind]}`, "", input.title, input.excerpt, input.byline ? `By ${input.byline}` : "", "", text, input.url ? `\nRead the full story: ${input.url}` : ""].filter(line => line !== undefined).join("\n").trim();
}
