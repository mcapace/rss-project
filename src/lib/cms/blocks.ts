/**
 * The structured block model: TipTap document JSON, the same shape the editor
 * produces, so one representation serves the editor, the migration
 * normalizer and the delivery API.
 *
 * `htmlToDocument` turns legacy HTML (Morweb exports, print backups, pasted
 * markup) into clean blocks: inline CSS, classes, ids, font tags and layout
 * wrappers are dropped; only the semantic structure and the whitelisted
 * text styles survive. `documentToHtml` renders blocks back to the HTML the
 * editor would emit, so normalizing is a pure, repeatable transform.
 */
import { parseDocument } from "htmlparser2";
import type { ChildNode, Element } from "domhandler";

export type BlockMark = { type: string; attrs?: Record<string, string | number | boolean | null> };
export type BlockNode = { type: string; attrs?: Record<string, string | number | boolean | null>; content?: BlockNode[]; text?: string; marks?: BlockMark[] };
export type BlockDocument = { type: "doc"; content: BlockNode[] };

const BLOCK_CONTAINERS = new Set(["div", "section", "article", "main", "aside", "header", "footer", "center", "font", "body", "html", "span-block", "details", "summary", "nav", "form", "fieldset"]);
const SKIP = new Set(["script", "style", "noscript", "iframe", "object", "embed", "template", "head", "meta", "link", "title", "svg", "canvas", "button", "input", "select", "textarea", "label"]);
const HEADINGS: Record<string, number> = { h1: 2, h2: 2, h3: 3, h4: 4, h5: 4, h6: 4 };
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([^)]+\))$/i;
const FONT_FAMILY = /^[a-z0-9 ,'"-]{1,120}$/i;
const FONT_SIZE = /^\d{1,3}(\.\d{1,2})?(px|pt|em|rem|%)$/;

function styleMap(style: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (style ?? "").split(";")) {
    const [key, ...rest] = part.split(":");
    if (!key || !rest.length) continue;
    out[key.trim().toLowerCase()] = rest.join(":").trim();
  }
  return out;
}

function isElement(node: ChildNode): node is Element { return node.type === "tag" || node.type === "script" || node.type === "style"; }

function collapse(text: string): string { return text.replace(/\s+/g, " "); }

type Inline = BlockNode[];

/** Marks implied by an element: formatting tags and whitelisted inline styles. */
function marksFor(element: Element, inherited: BlockMark[]): BlockMark[] {
  const marks = [...inherited];
  const add = (mark: BlockMark) => { if (!marks.some(m => m.type === mark.type && JSON.stringify(m.attrs ?? {}) === JSON.stringify(mark.attrs ?? {}))) marks.push(mark); };
  switch (element.name) {
    case "b": case "strong": add({ type: "bold" }); break;
    case "i": case "em": case "cite": case "var": add({ type: "italic" }); break;
    case "u": case "ins": add({ type: "underline" }); break;
    case "s": case "strike": case "del": add({ type: "strike" }); break;
    case "code": case "kbd": case "samp": case "tt": add({ type: "code" }); break;
    case "sub": add({ type: "subscript" }); break;
    case "sup": add({ type: "superscript" }); break;
    case "mark": add({ type: "highlight", attrs: COLOR.test(element.attribs["data-color"] ?? "") ? { color: element.attribs["data-color"] } : {} }); break;
    case "a": {
      const href = (element.attribs.href ?? "").trim();
      if (/^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(href)) add({ type: "link", attrs: { href, target: element.attribs.target === "_blank" ? "_blank" : null, rel: "noopener noreferrer" } });
      break;
    }
  }
  const style = styleMap(element.attribs.style);
  const textStyle: Record<string, string> = {};
  if (style.color && COLOR.test(style.color)) textStyle.color = style.color;
  if (style["font-family"] && FONT_FAMILY.test(style["font-family"])) textStyle.fontFamily = style["font-family"];
  if (style["font-size"] && FONT_SIZE.test(style["font-size"])) textStyle.fontSize = style["font-size"];
  if (element.name === "font" && element.attribs.color && COLOR.test(element.attribs.color)) textStyle.color = element.attribs.color;
  if (/^(bold|[6-9]00)$/.test(style["font-weight"] ?? "")) add({ type: "bold" });
  if (style["font-style"] === "italic") add({ type: "italic" });
  if ((style["text-decoration"] ?? "").includes("underline")) add({ type: "underline" });
  if ((style["text-decoration"] ?? "").includes("line-through")) add({ type: "strike" });
  if (Object.keys(textStyle).length) {
    const existing = marks.find(m => m.type === "textStyle");
    if (existing) existing.attrs = { ...existing.attrs, ...textStyle }; else marks.push({ type: "textStyle", attrs: textStyle });
  }
  return marks;
}

function inlineOf(nodes: ChildNode[], marks: BlockMark[], out: Inline): void {
  for (const node of nodes) {
    if (node.type === "text") {
      const text = collapse(node.data);
      if (!text) continue;
      const last = out[out.length - 1];
      if (last?.type === "text" && JSON.stringify(last.marks ?? []) === JSON.stringify(marks)) last.text += text;
      else out.push({ type: "text", text, ...(marks.length ? { marks: marks.map(m => ({ ...m })) } : {}) });
      continue;
    }
    if (!isElement(node) || SKIP.has(node.name)) continue;
    if (node.name === "br") { out.push({ type: "hardBreak" }); continue; }
    if (node.name === "img") continue; // Inline images become their own block (handled by the block walker).
    inlineOf(node.children, marksFor(node, marks), out);
  }
}

function trimInline(inline: Inline): Inline {
  const first = inline[0], last = inline[inline.length - 1];
  if (first?.type === "text") first.text = first.text!.replace(/^\s+/, "");
  if (last?.type === "text") last.text = last.text!.replace(/\s+$/, "");
  return inline.filter(node => node.type !== "text" || node.text);
}

function blockAttrs(element: Element): Record<string, string | number | boolean | null> {
  const attrs: Record<string, string | number | boolean | null> = {};
  const align = styleMap(element.attribs.style)["text-align"] ?? element.attribs.align;
  if (align && /^(left|right|center|justify)$/.test(align)) attrs.textAlign = align;
  if (element.attribs["data-premium"] === "true") attrs.premium = true;
  return attrs;
}

function paragraph(inline: Inline, attrs: Record<string, string | number | boolean | null> = {}): BlockNode | null {
  const content = trimInline(inline);
  if (!content.length) return null;
  return { type: "paragraph", ...(Object.keys(attrs).length ? { attrs } : {}), content };
}

function textOf(nodes: ChildNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") out += node.data;
    else if (isElement(node) && !SKIP.has(node.name)) out += textOf(node.children);
  }
  return collapse(out).trim();
}

function firstElement(nodes: ChildNode[], name: string): Element | null {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    if (node.name === name) return node;
    const nested = firstElement(node.children, name);
    if (nested) return nested;
  }
  return null;
}

/** Walk a block-level sequence, wrapping loose inline runs into paragraphs. */
function blocksOf(nodes: ChildNode[], out: BlockNode[], inherited: Record<string, string | number | boolean | null> = {}): void {
  let run: Inline = [];
  const flush = () => { const p = paragraph(run, inherited); if (p) out.push(p); run = []; };
  for (const node of nodes) {
    if (node.type === "text") { if (collapse(node.data).trim() || run.length) inlineOf([node], [], run); continue; }
    if (!isElement(node) || SKIP.has(node.name)) continue;
    const name = node.name;
    const attrs = { ...inherited, ...blockAttrs(node) };
    const withAttrs = (block: BlockNode): BlockNode => Object.keys(attrs).length ? { ...block, attrs: { ...(block.attrs ?? {}), ...attrs } } : block;
    if (name === "p") { flush(); const inline: Inline = []; inlineOf(node.children, [], inline); const image = firstElement(node.children, "img"); const p = paragraph(inline, attrs); if (p) out.push(p); if (image) blocksOf([image], out, attrs); continue; }
    if (name in HEADINGS) { flush(); const inline: Inline = []; inlineOf(node.children, [], inline); const content = trimInline(inline); if (content.length) out.push({ type: "heading", attrs: { level: HEADINGS[name], ...attrs }, content }); continue; }
    if (name === "ul" || name === "ol") {
      flush();
      const items: BlockNode[] = [];
      for (const child of node.children) {
        if (!isElement(child) || child.name !== "li") continue;
        const inner: BlockNode[] = [];
        blocksOf(child.children, inner);
        if (!inner.length) continue;
        if (inner[0].type !== "paragraph") inner.unshift({ type: "paragraph" });
        items.push({ type: "listItem", content: inner });
      }
      if (items.length) out.push(withAttrs({ type: name === "ul" ? "bulletList" : "orderedList", ...(name === "ol" && /^\d+$/.test(node.attribs.start ?? "") ? { attrs: { start: Number(node.attribs.start) } } : {}), content: items }));
      continue;
    }
    if (name === "blockquote") { flush(); const inner: BlockNode[] = []; blocksOf(node.children, inner); if (inner.length) out.push(withAttrs({ type: "blockquote", content: inner })); continue; }
    if (name === "pre") { flush(); const text = textOf(node.children); if (text) out.push(withAttrs({ type: "codeBlock", content: [{ type: "text", text }] })); continue; }
    if (name === "hr") { flush(); out.push(withAttrs({ type: "horizontalRule" })); continue; }
    if (name === "img") {
      flush();
      const src = (node.attribs.src ?? node.attribs["data-src"] ?? "").trim();
      if (/^(https?:\/\/|\/(?!\/))/i.test(src)) out.push(withAttrs({ type: "image", attrs: { src, alt: collapse(node.attribs.alt ?? "").trim(), title: node.attribs.title?.trim() || null, ...attrs } }));
      continue;
    }
    if (name === "figure") {
      flush();
      const link = firstElement(node.children, "a");
      const caption = textOf(firstElement(node.children, "figcaption")?.children ?? []);
      if (node.attribs["data-embed"] && link?.attribs.href) { out.push(withAttrs({ type: "videoEmbed", attrs: { href: link.attribs.href.trim(), caption, ...attrs } })); continue; }
      const image = firstElement(node.children, "img");
      if (image) { const src = (image.attribs.src ?? "").trim(); if (/^(https?:\/\/|\/(?!\/))/i.test(src)) out.push(withAttrs({ type: "image", attrs: { src, alt: collapse(image.attribs.alt ?? "").trim(), title: caption || null, ...attrs } })); continue; }
      blocksOf(node.children, out, attrs); continue;
    }
    if (name === "table") {
      flush();
      const rows: BlockNode[] = [];
      const walkRows = (children: ChildNode[]) => {
        for (const child of children) {
          if (!isElement(child)) continue;
          if (child.name === "tr") {
            const cells: BlockNode[] = [];
            for (const cell of child.children) {
              if (!isElement(cell) || (cell.name !== "td" && cell.name !== "th")) continue;
              const inner: BlockNode[] = [];
              blocksOf(cell.children, inner);
              if (!inner.length) inner.push({ type: "paragraph" });
              const span: Record<string, number> = {};
              if (/^\d+$/.test(cell.attribs.colspan ?? "") && Number(cell.attribs.colspan) > 1) span.colspan = Number(cell.attribs.colspan);
              if (/^\d+$/.test(cell.attribs.rowspan ?? "") && Number(cell.attribs.rowspan) > 1) span.rowspan = Number(cell.attribs.rowspan);
              cells.push({ type: cell.name === "th" ? "tableHeader" : "tableCell", ...(Object.keys(span).length ? { attrs: span } : {}), content: inner });
            }
            if (cells.length) rows.push({ type: "tableRow", content: cells });
          } else if (["thead", "tbody", "tfoot"].includes(child.name)) walkRows(child.children);
        }
      };
      walkRows(node.children);
      if (rows.length) out.push(withAttrs({ type: "table", content: rows }));
      continue;
    }
    if (name === "br") { run.push({ type: "hardBreak" }); continue; }
    if (BLOCK_CONTAINERS.has(name) || name === "li" || name === "dl" || name === "dt" || name === "dd") {
      // A wrapper: inline-only content becomes one paragraph; block content is lifted out.
      const hasBlocks = node.children.some(child => isElement(child) && (child.name === "p" || child.name in HEADINGS || ["ul", "ol", "blockquote", "pre", "hr", "img", "figure", "table", "div", "section", "article"].includes(child.name)));
      if (hasBlocks) { flush(); blocksOf(node.children, out, attrs); }
      else inlineOf(node.children, [], run);
      continue;
    }
    // Any other inline element joins the current run.
    inlineOf([node], [], run);
  }
  flush();
}

/** Legacy or editor HTML to a clean block document. */
export function htmlToDocument(html: string): BlockDocument {
  const dom = parseDocument(html ?? "", { decodeEntities: true });
  const content: BlockNode[] = [];
  blocksOf(dom.children, content);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function openMarks(marks: BlockMark[] = []): [string, string] {
  let open = "", close = "";
  for (const mark of marks) {
    const attrs = mark.attrs ?? {};
    let tag: string | null = null, extra = "";
    switch (mark.type) {
      case "bold": tag = "strong"; break;
      case "italic": tag = "em"; break;
      case "underline": tag = "u"; break;
      case "strike": tag = "s"; break;
      case "code": tag = "code"; break;
      case "subscript": tag = "sub"; break;
      case "superscript": tag = "sup"; break;
      case "highlight": tag = "mark"; if (typeof attrs.color === "string") extra = ` data-color="${escape(attrs.color)}" style="background-color: ${escape(attrs.color)}"`; break;
      case "link": tag = "a"; extra = ` href="${escape(String(attrs.href ?? ""))}"${attrs.target ? ` target="${escape(String(attrs.target))}"` : ""} rel="noopener noreferrer"`; break;
      case "textStyle": {
        const style = [attrs.color ? `color: ${attrs.color}` : "", attrs.fontFamily ? `font-family: ${attrs.fontFamily}` : "", attrs.fontSize ? `font-size: ${attrs.fontSize}` : ""].filter(Boolean).join("; ");
        if (style) { tag = "span"; extra = ` style="${escape(style)}"`; }
        break;
      }
    }
    if (tag) { open += `<${tag}${extra}>`; close = `</${tag}>` + close; }
  }
  return [open, close];
}

function inlineHtml(nodes: BlockNode[] = []): string {
  return nodes.map(node => {
    if (node.type === "hardBreak") return "<br>";
    if (node.type !== "text") return "";
    const [open, close] = openMarks(node.marks);
    return `${open}${escape(node.text ?? "")}${close}`;
  }).join("");
}

function blockOpen(tag: string, attrs: Record<string, unknown> = {}, extra = ""): string {
  const align = typeof attrs.textAlign === "string" && attrs.textAlign !== "left" ? ` style="text-align: ${escape(attrs.textAlign)}"` : "";
  const premium = attrs.premium === true ? ` data-premium="true"` : "";
  return `<${tag}${extra}${align}${premium}>`;
}

/** Blocks back to the HTML the editor would emit. */
export function documentToHtml(doc: BlockDocument | BlockNode): string {
  const render = (node: BlockNode): string => {
    const attrs = node.attrs ?? {};
    switch (node.type) {
      case "doc": return (node.content ?? []).map(render).join("");
      case "paragraph": return `${blockOpen("p", attrs)}${inlineHtml(node.content)}</p>`;
      case "heading": return `${blockOpen(`h${attrs.level ?? 2}`, attrs)}${inlineHtml(node.content)}</h${attrs.level ?? 2}>`;
      case "bulletList": return `${blockOpen("ul", attrs)}${(node.content ?? []).map(render).join("")}</ul>`;
      case "orderedList": return `${blockOpen("ol", attrs, typeof attrs.start === "number" && attrs.start !== 1 ? ` start="${attrs.start}"` : "")}${(node.content ?? []).map(render).join("")}</ol>`;
      case "listItem": return `<li>${(node.content ?? []).map(render).join("")}</li>`;
      case "blockquote": return `${blockOpen("blockquote", attrs)}${(node.content ?? []).map(render).join("")}</blockquote>`;
      case "codeBlock": return `${blockOpen("pre", attrs)}<code>${escape((node.content ?? []).map(n => n.text ?? "").join(""))}</code></pre>`;
      case "horizontalRule": return blockOpen("hr", attrs).replace(/>$/, ">");
      case "image": return `<img src="${escape(String(attrs.src ?? ""))}" alt="${escape(String(attrs.alt ?? ""))}"${attrs.title ? ` title="${escape(String(attrs.title))}"` : ""}${attrs.premium === true ? ` data-premium="true"` : ""}>`;
      case "videoEmbed": return `<figure data-embed="video"${attrs.premium === true ? ` data-premium="true"` : ""}><a href="${escape(String(attrs.href ?? ""))}" rel="noopener noreferrer" target="_blank">Watch video</a>${attrs.caption ? `<figcaption>${escape(String(attrs.caption))}</figcaption>` : ""}</figure>`;
      case "table": return `${blockOpen("table", attrs)}<tbody>${(node.content ?? []).map(render).join("")}</tbody></table>`;
      case "tableRow": return `<tr>${(node.content ?? []).map(render).join("")}</tr>`;
      case "tableCell": case "tableHeader": {
        const tag = node.type === "tableHeader" ? "th" : "td";
        const span = `${typeof attrs.colspan === "number" ? ` colspan="${attrs.colspan}"` : ""}${typeof attrs.rowspan === "number" ? ` rowspan="${attrs.rowspan}"` : ""}`;
        return `<${tag}${span}>${(node.content ?? []).map(render).join("")}</${tag}>`;
      }
      default: return node.content ? node.content.map(render).join("") : "";
    }
  };
  return render(doc as BlockNode);
}

/** Normalize legacy markup: parse to blocks and render back, dropping everything that is not structure or whitelisted style. */
export function normalizeLegacyHtml(html: string): { html: string; document: BlockDocument } {
  const document = htmlToDocument(html);
  return { html: documentToHtml(document), document };
}

/** Counts for reports and tests. */
export function blockSummary(doc: BlockDocument): Record<string, number> {
  const counts: Record<string, number> = {};
  const walk = (node: BlockNode) => { counts[node.type] = (counts[node.type] ?? 0) + 1; node.content?.forEach(walk); };
  doc.content.forEach(walk);
  return counts;
}

/** Plain text of a block document, for embeddings and search. */
export function documentText(doc: BlockDocument | null | undefined): string {
  if (!doc) return "";
  const parts: string[] = [];
  const walk = (node: BlockNode) => { if (node.type === "text") parts.push(node.text ?? ""); node.content?.forEach(walk); if (["paragraph", "heading", "listItem", "codeBlock"].includes(node.type)) parts.push("\n"); };
  doc.content.forEach(walk);
  return parts.join("").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}
