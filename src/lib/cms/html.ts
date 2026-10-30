import sanitizeHtml from "sanitize-html";

/**
 * Inline styles the editor may keep. Values are matched strictly so no URL,
 * expression or position can ride along; anything else is dropped.
 */
const COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/i];
const ALLOWED_STYLES: Record<string, RegExp[]> = {
  color: COLOR,
  "background-color": COLOR,
  "font-family": [/^[a-z0-9 ,'"-]{1,120}$/i],
  "font-size": [/^(\d{1,3}(\.\d{1,2})?)(px|pt|em|rem|%)$/],
  "line-height": [/^\d(\.\d{1,2})?$/],
  "text-align": [/^(left|right|center|justify)$/],
};
const STYLED_TAGS = ["p", "span", "h1", "h2", "h3", "h4", "li", "blockquote", "td", "th", "figcaption"];
/** Block elements an editor may mark premium; the delivery tier strips them for readers without entitlement. */
const PREMIUM_TAGS = ["p", "h1", "h2", "h3", "h4", "ul", "ol", "blockquote", "figure", "table", "pre", "hr", "img"];

/** Sanitize the working copy/preview; immutable ingestion snapshots remain untouched. */
export function sanitizeCmsHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "del", "ins", "mark", "small", "code", "pre", "h1", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "a", "img", "figure", "figcaption", "hr", "table", "thead", "tbody", "tr", "td", "th", "span", "sup", "sub"],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height"],
      td: ["colspan", "rowspan", "style"], th: ["colspan", "rowspan", "style"], ol: ["start"],
      // Embeds are stored as a figure holding the canonical link; renderers turn them into players.
      figure: ["data-embed"],
      ...Object.fromEntries(STYLED_TAGS.filter(tag => tag !== "td" && tag !== "th").map(tag => [tag, ["style"]])),
      ...Object.fromEntries(PREMIUM_TAGS.map(tag => [tag, [...new Set([...(tag === "img" ? ["src", "alt", "title", "width", "height"] : tag === "figure" ? ["data-embed"] : STYLED_TAGS.includes(tag) ? ["style"] : tag === "ol" ? ["start"] : []), "data-premium"])]])),
    },
    allowedStyles: { "*": ALLOWED_STYLES },
    allowedSchemes: ["https", "http", "mailto", "tel"],
    allowedSchemesByTag: { img: ["https", "http"] },
    allowProtocolRelative: false,
    transformTags: { a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, rel: "noopener noreferrer" } }) },
  });
}
