/**
 * Legacy captions and photo credits. The old Whisky Advocate site stored a
 * lead caption in a custom field, WordPress-era captions as text inside an
 * attachment wrapper, and Morweb-era captions in each image's alt text, with
 * the photographer appended in capitals ("... at Four Roses. FOUR ROSES").
 * These helpers recover them as caption + credit and write body images as
 * <figure> blocks with a <figcaption>.
 */

export type Caption = { caption: string; credit: string };

const CREDIT_LEAD = /^(?:photo(?:graph)?s?|image|picture)\s*(?:credit\s*)?(?:by|:)\s*|^photo credit\s*:?\s*|^credit\s*:\s*/i;
const CREDIT_WORDS = /\b(?:PHOTO|PHOTOGRAPH|PHOTOGRAPHY|COURTESY|GETTY|ISTOCK|ISTOCKPHOTO|SHUTTERSTOCK|ALAMY|ILLUSTRATION|IMAGES?)\b/;

function tidy(text: string): string {
  return text.replace(/\s+/g, " ").replace(/^[\s,;–—-]+|[\s,;–—-]+$/g, "").trim();
}

function creditText(raw: string): string {
  return tidy(raw.replace(/^\(|\)$/g, "").replace(CREDIT_LEAD, ""));
}

/** Split a legacy caption into its caption and photo credit. */
export function splitCredit(input: string): Caption {
  const text = tidy(input);
  if (!text) return { caption: "", credit: "" };
  // "(Photo by Jeff Harris)", "Photo: Fabio Lovino/HBO", "Courtesy of Puni" at the end.
  const tagged = text.match(/^(.*?)\s*\(?((?:photo(?:graph)?s?\s*(?:credit\s*)?(?:by|:)|photo credit\s*:?|image credit\s*:|credit\s*:|courtesy(?:\s+of)?\b|illustrations?\s*(?:by|:))[^()]*?)\)?$/i);
  if (tagged && tagged[2]) {
    const credit = creditText(tagged[2]);
    if (credit) return { caption: tidy(tagged[1]), credit };
  }
  // A trailing run of capitals: two or more words, or one that names a credit.
  const caps = text.match(/^(.*?[a-z0-9.!?"”’)\]])?\s*((?:[A-Z][A-Z0-9'’.&\-/]*)(?:\s+(?:[A-Z][A-Z0-9'’.&\-/]*|\/|&|OF|BY))*)$/);
  if (caps && caps[2]) {
    const run = caps[2].trim();
    const words = run.split(/\s+/).filter(word => /[A-Z]{2,}/.test(word));
    if ((words.length >= 2 || CREDIT_WORDS.test(run)) && /[A-Z]{2}/.test(run)) {
      return { caption: tidy(caps[1] ?? ""), credit: creditText(run) };
    }
  }
  return { caption: text, credit: "" };
}

/** The old site showed alt text as a caption unless it was a filename; tags and stray values are not captions either. */
export function altCaption(alt: string): string {
  const text = tidy(alt);
  if (!text || /\.(?:jpe?g|png|gif|webp|avif)\b/i.test(text)) return "";
  if (/^[\d\s.,#-]*$/.test(text)) return "";
  if (text === text.toLowerCase() && !/[.!?]/.test(text)) return "";
  if (text.split(/\s+/).length < 2 && !/[A-Z]{2}/.test(text)) return "";
  return text;
}

function escapeText(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function figcaptionHtml({ caption, credit }: Caption): string {
  if (!caption && !credit) return "";
  const parts = [caption ? escapeText(caption) : "", credit ? `<span>${escapeText(credit)}</span>` : ""].filter(Boolean);
  return `<figcaption>${parts.join(" ")}</figcaption>`;
}

const IMG_OR_LINKED = String.raw`(?:<a\b[^>]*>\s*)?<img\b[^>]*>(?:\s*</a>)?`;
const ALT = /\balt=["']([^"']*)["']/i;
const SRC = /\bsrc=["']([^"']+)["']/i;

function plainCaption(html: string): string {
  return tidy(html.replace(/<br\s*\/?>/gi, " ").replace(/<(?!\/?(?:em|i|strong|b)\b)[^>]+>/gi, ""));
}

export type CaptionedImage = { src: string } & Caption;

/** Captions already written as <figure><img><figcaption>caption <span>credit</span></figcaption></figure>. */
export function figureCaptions(html: string): CaptionedImage[] {
  const out: CaptionedImage[] = [];
  for (const match of html.matchAll(/<figure\b[^>]*>([\s\S]*?)<\/figure>/gi)) {
    const src = SRC.exec(match[1])?.[1];
    const cap = /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i.exec(match[1])?.[1];
    if (!src || !cap) continue;
    const credit = /<span\b[^>]*>([\s\S]*?)<\/span>\s*$/i.exec(cap)?.[1] ?? "";
    const caption = credit ? cap.replace(/<span\b[^>]*>[\s\S]*?<\/span>\s*$/i, "") : cap;
    out.push({ src, caption: tidy(caption.replace(/<[^>]+>/g, "")), credit: tidy(credit.replace(/<[^>]+>/g, "")) });
  }
  return out;
}

/**
 * Rewrite a body so legacy captions become <figure>/<figcaption>. Returns the
 * new HTML and every captioned image (by src) so media records can carry the
 * same caption and credit.
 */
export function restoreBodyCaptions(html: string): { html: string; images: CaptionedImage[] } {
  const images: CaptionedImage[] = [];
  const figure = (image: string, text: Caption) => {
    const src = SRC.exec(image)?.[1] ?? "";
    if (src && (text.caption || text.credit)) images.push({ src, ...text });
    return `<figure>${image}${figcaptionHtml(text)}</figure>`;
  };
  let out = html;
  // WordPress: <div id="attachment_123" ...><img ...> Caption text</div>
  out = out.replace(new RegExp(String.raw`<div\b[^>]*\bid=["']attachment_\d+["'][^>]*>(?:\s|<br\s*/?>)*(${IMG_OR_LINKED})([\s\S]*?)</div>`, "gi"), (_whole, image: string, rest: string) => {
    const text = splitCredit(plainCaption(rest).replace(/<[^>]+>/g, ""));
    return figure(image, text);
  });
  // Morweb: a paragraph holding only an image (or images) whose alt text is the caption.
  out = out.replace(new RegExp(String.raw`<p\b[^>]*>((?:\s|&nbsp;|<br\s*/?>)*(?:${IMG_OR_LINKED}(?:\s|&nbsp;|<br\s*/?>)*)+)</p>`, "gi"), (whole, inner: string) => {
    const found = inner.match(new RegExp(IMG_OR_LINKED, "gi")) ?? [];
    if (!found.some(image => altCaption(ALT.exec(image)?.[1] ?? ""))) return whole;
    return found.map(image => {
      const caption = altCaption(ALT.exec(image)?.[1] ?? "");
      return caption ? figure(image, splitCredit(caption)) : `<p>${image}</p>`;
    }).join("");
  });
  return { html: out, images };
}
