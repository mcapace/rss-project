/**
 * Newsletter rendering: the same single-column, table-based template the
 * editor's email preview shows, produced server-side for the ESP. Pure so it
 * can be tested and reused by the preview.
 */
import type { CmsBrand } from "@/lib/cms/types";

export const BRAND_INK: Record<CmsBrand, string> = { wa: "#3d5a80", ws: "#6f1d2b", ca: "#b45309", mw: "#1b4332" };
export const BRAND_NAMES: Record<CmsBrand, string> = { wa: "Whisky Advocate", ws: "Wine Spectator", ca: "Cigar Aficionado", mw: "Market Watch" };
export const NEWSLETTER_KINDS = ["daily_alert", "weekly", "breaking", "custom"] as const;
export type NewsletterKind = (typeof NEWSLETTER_KINDS)[number];
export const KIND_LABELS: Record<NewsletterKind, string> = { daily_alert: "Daily Alert", weekly: "Weekly", breaking: "Breaking", custom: "Custom send" };

export type NewsletterInput = {
  brand: CmsBrand; kind: NewsletterKind; subject: string; preheader?: string | null;
  title: string; byline: string; excerpt: string; section: string; html: string; url: string | null;
};

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The email keeps the lede and the first section; the rest stays on the site. */
export function newsletterBody(html: string): { body: string; truncated: boolean } {
  const parts = html.split(/(?=<h2)/i);
  const body = parts.slice(0, 2).join("");
  return { body, truncated: body.length < html.length };
}

export function renderNewsletterHtml(input: NewsletterInput): string {
  const ink = BRAND_INK[input.brand];
  const name = BRAND_NAMES[input.brand];
  const { body, truncated } = newsletterBody(input.html);
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
  const text = newsletterBody(input.html).body.replace(/<\/(p|h2|h3|li|blockquote)>/gi, "\n\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n{3,}/g, "\n\n").trim();
  return [`${BRAND_NAMES[input.brand]} · ${KIND_LABELS[input.kind]}`, "", input.title, input.excerpt, input.byline ? `By ${input.byline}` : "", "", text, input.url ? `\nRead the full story: ${input.url}` : ""].filter(line => line !== undefined).join("\n").trim();
}
