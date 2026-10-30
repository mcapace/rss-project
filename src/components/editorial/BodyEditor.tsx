"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, Extension, mergeAttributes, Node, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";
import type * as Y from "yjs";
import type { BlockDocument } from "@/lib/cms/blocks";
import type { SupabaseProvider } from "./collab/SupabaseProvider";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { TextStyleKit } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, ChevronDown, Code2, Eraser, Heading2, Heading3, Highlighter, ImagePlus, Italic, Link as LinkIcon, List, ListOrdered, Minus, MoreHorizontal, Quote, Redo2, SquareCode, Strikethrough, Subscript as SubIcon, Superscript as SupIcon, Table as TableIcon, Type, Underline, Undo2, Video, Lock } from "lucide-react";
import { useDismiss } from "./hooks";
import { Notice } from "./ui";

/* ------------------------------------------------------------------ */
/* Video embed: stored as <figure data-embed="video"><a href=…>…</a></figure> */
/* so the sanitizer keeps it and renderers turn the link into a player. */
/* ------------------------------------------------------------------ */

export function embedFor(url: string): { provider: "youtube" | "vimeo"; id: string; src: string } | null {
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.replace(/^www\./, "");
    if (host === "youtu.be") { const id = parsed.pathname.slice(1).split("/")[0]; return id ? { provider: "youtube", id, src: `https://www.youtube-nocookie.com/embed/${id}` } : null; }
    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
      const id = parsed.searchParams.get("v") || parsed.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{6,})/)?.[1];
      return id && /^[\w-]{6,}$/.test(id) ? { provider: "youtube", id, src: `https://www.youtube-nocookie.com/embed/${id}` } : null;
    }
    if (host === "vimeo.com" || host === "player.vimeo.com") {
      const id = parsed.pathname.match(/(\d{6,})/)?.[1];
      return id ? { provider: "vimeo", id, src: `https://player.vimeo.com/video/${id}` } : null;
    }
  } catch { /* not a URL */ }
  return null;
}

/* Premium blocks: any block an editor marks premium carries data-premium="true" */
/* and is stripped at the edge for readers without entitlement.              */
const PREMIUM_TYPES = ["paragraph", "heading", "blockquote", "bulletList", "orderedList", "image", "videoEmbed", "table", "codeBlock", "horizontalRule"];
const Premium = Extension.create({
  name: "premium",
  addGlobalAttributes() {
    return [{ types: PREMIUM_TYPES, attributes: { premium: {
      default: false, keepOnSplit: false,
      parseHTML: element => element.getAttribute("data-premium") === "true",
      renderHTML: attributes => attributes.premium ? { "data-premium": "true" } : {},
    } } }];
  },
});

/** The block the selection sits in, if it can be marked premium. */
function premiumBlock(editor: Editor): { name: string; premium: boolean } | null {
  const selection = editor.state.selection as typeof editor.state.selection & { node?: { type: { name: string }; attrs: Record<string, unknown> } };
  if (selection.node && PREMIUM_TYPES.includes(selection.node.type.name)) return { name: selection.node.type.name, premium: selection.node.attrs.premium === true };
  const { $from } = selection;
  for (let depth = $from.depth; depth >= 1; depth--) {
    const node = $from.node(depth);
    if (PREMIUM_TYPES.includes(node.type.name)) return { name: node.type.name, premium: node.attrs.premium === true };
  }
  return null;
}

export type CollaborationHandle = { doc: Y.Doc; provider: SupabaseProvider | null; user: { id: string; name: string; color: string } | null };

const VideoEmbed = Node.create({
  name: "videoEmbed",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() { return { href: { default: "" }, caption: { default: "" } }; },
  parseHTML() {
    return [{
      tag: "figure[data-embed]",
      getAttrs: element => {
        const figure = element as HTMLElement;
        const link = figure.querySelector("a");
        const href = link?.getAttribute("href") ?? "";
        return embedFor(href) ? { href, caption: figure.querySelector("figcaption")?.textContent ?? "" } : false;
      },
    }];
  },
  renderHTML({ HTMLAttributes }) {
    const href = String(HTMLAttributes.href ?? "");
    const embed = embedFor(href);
    const children: unknown[] = [["a", { href, rel: "noopener noreferrer", target: "_blank" }, embed ? `Watch on ${embed.provider === "youtube" ? "YouTube" : "Vimeo"}` : "Watch video"]];
    if (HTMLAttributes.caption) children.push(["figcaption", {}, String(HTMLAttributes.caption)]);
    return ["figure", mergeAttributes({ "data-embed": "video" }), ...children] as never;
  },
  addNodeView() {
    return ({ node }) => {
      const embed = embedFor(String(node.attrs.href ?? ""));
      const figure = document.createElement("figure");
      figure.setAttribute("data-embed", "video");
      const frame = document.createElement("div");
      frame.className = "ed-embed";
      if (embed) {
        const iframe = document.createElement("iframe");
        iframe.src = embed.src; iframe.title = `${embed.provider} video`; iframe.loading = "lazy"; iframe.allow = "accelerometer; encrypted-media; picture-in-picture"; iframe.referrerPolicy = "strict-origin-when-cross-origin";
        iframe.setAttribute("allowfullscreen", "true");
        frame.appendChild(iframe);
      } else {
        const card = document.createElement("div"); card.className = "ed-embed-card"; card.textContent = `Video: ${node.attrs.href}`; frame.appendChild(card);
      }
      figure.appendChild(frame);
      if (node.attrs.caption) { const caption = document.createElement("figcaption"); caption.textContent = String(node.attrs.caption); figure.appendChild(caption); }
      return { dom: figure };
    };
  },
});

/* ------------------------------------------------------------------ */

export type InsertableImage = { src: string; alt: string; caption: string; /** Thumbnail for the picker when it differs from the inserted src. */ preview?: string };

const FONTS = [
  { label: "Default", value: "" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Sans", value: "Inter, system-ui, sans-serif" },
  { label: "Display", value: "'Playfair Display', Georgia, serif" },
  { label: "Mono", value: "'JetBrains Mono', ui-monospace, monospace" },
];
const SIZES = ["", "14px", "16px", "18px", "20px", "24px", "28px"];

type Props = {
  html: string;
  onChange: (html: string, json: BlockDocument) => void;
  readOnly?: boolean;
  /** Shared Yjs document and Realtime provider; when present the body is edited collaboratively. */
  collab?: CollaborationHandle;
  /** The page replaced the body on purpose (revision restore, source adoption, assistant edit, draft recovery): write the current html into the editor and the shared document, even on a fresh mount. */
  applyHtml?: boolean;
  onHtmlApplied?: () => void;
  /** Images attached to the document, offered by the insert-image control. */
  images?: InsertableImage[];
  /** Called when the editor is ready so the page can wire actions (for example inserting an FAQ). */
  onReady?: (editor: Editor | null) => void;
};

/**
 * The story body. Rich text through TipTap with styles, fonts, colors, alignment,
 * tables, images and video embeds; anything TipTap cannot represent switches to a
 * lossless HTML view so imported markup is never silently dropped.
 */
export function BodyEditor({ html, onChange, readOnly = false, images = [], onReady, collab, applyHtml = false, onHtmlApplied }: Props) {
  const [sourceMode, setSourceMode] = useState(false);
  const [panel, setPanel] = useState<"" | "link" | "video" | "image">("");
  const [field, setField] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [warning, setWarning] = useState("");
  const [menu, setMenu] = useState<"" | "style" | "more">("");
  const closeMenu = useCallback(() => setMenu(""), []);
  const menuRef = useDismiss(menu === "style", closeMenu);
  const moreRef = useDismiss(menu === "more", closeMenu);
  const preserveSource = useCallback(() => { setSourceMode(true); setPanel(""); setWarning("This story contains elements the visual editor cannot preserve. Its HTML is kept exactly here; use Preview to read it."); }, []);

  const collaborative = Boolean(collab);
  // What the editor last reported, so an external change to `html` (restore, assistant apply) can be told apart from our own echo.
  const emitted = useRef<string | null>(null);
  // The html prop as last seen, so only a *change* to it counts as external; the saved body a story opens with never does.
  const seenProp = useRef<string>(html);
  const editor = useEditor({
    extensions: [
      // In collaborative mode history comes from Yjs, so the local undo stack is off.
      StarterKit.configure({ heading: { levels: [2, 3, 4] }, link: { openOnClick: false }, ...(collaborative ? { undoRedo: false } : {}) }),
      Image.configure({ inline: false, allowBase64: false }), TableKit, TextStyleKit, Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }), Subscript, Superscript, VideoEmbed, CharacterCount, Premium,
      Placeholder.configure({ placeholder: "Start the story…" }),
      ...(collab ? [Collaboration.configure({ document: collab.doc })] : []),
      ...(collab?.provider && collab.user ? [CollaborationCaret.configure({ provider: collab.provider, user: { name: collab.user.name, color: collab.user.color } })] : []),
    ],
    ...(collaborative ? {} : { content: html }), immediatelyRender: false, enableContentCheck: true, editable: !readOnly,
    editorProps: { attributes: { class: "tiptap", "aria-label": "Story body", role: "textbox", "aria-multiline": "true" } },
    onUpdate: ({ editor }) => { const next = editor.getHTML(); emitted.current = next; onChange(next, editor.getJSON() as BlockDocument); },
    onContentError: preserveSource,
  }, [collaborative]);
  useEffect(() => { onReady?.(editor); return () => onReady?.(null); }, [editor, onReady]);

  // First editor in an empty shared document seeds it from the saved body.
  useEffect(() => {
    if (!editor || !collab) return;
    if (collab.doc.getXmlFragment("default").length === 0 && html.trim() && html !== "<p></p>") {
      try { editor.commands.setContent(html, { emitUpdate: true, errorOnInvalidContent: true }); }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- A rejected parse must fall back to the lossless HTML view.
      catch { preserveSource(); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once per editor instance
  }, [editor, collab]);

  // An explicit replacement always wins: the prop guard below cannot tell a restore that remounted the editor from a stale saved body.
  useEffect(() => {
    if (!editor || !applyHtml) return;
    if (!sourceMode && html !== editor.getHTML()) {
      try { editor.commands.setContent(html, { emitUpdate: true, errorOnInvalidContent: true }); }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- A rejected parse must fall back to the lossless HTML view.
      catch { preserveSource(); }
    }
    seenProp.current = html;
    onHtmlApplied?.();
  }, [editor, applyHtml, html, sourceMode, preserveSource, onHtmlApplied]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!sourceMode && !readOnly, false);
    // In collaborative mode the shared document is the truth, except when the html changed outside the editor
    // (draft restore, assistant apply, source view): that change is written into the shared document too.
    if (collab && !sourceMode) {
      const unchangedProp = html === seenProp.current;
      seenProp.current = html;
      // The hydrated shared document wins over the saved body; only a later change to the prop is written in.
      if (unchangedProp || html === emitted.current || html === editor.getHTML()) return;
    }
    if (!sourceMode && html !== editor.getHTML()) {
      try { editor.commands.setContent(html, { emitUpdate: false, errorOnInvalidContent: true }); }
      catch {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- A rejected parse must fall back to the lossless HTML view.
        preserveSource();
      }
    }
  }, [editor, html, sourceMode, readOnly, preserveSource, collab]);

  const active = useEditorState({ editor, selector: ({ editor }) => ({
    bold: !!editor?.isActive("bold"), italic: !!editor?.isActive("italic"), underline: !!editor?.isActive("underline"), strike: !!editor?.isActive("strike"),
    h2: !!editor?.isActive("heading", { level: 2 }), h3: !!editor?.isActive("heading", { level: 3 }),
    bullet: !!editor?.isActive("bulletList"), ordered: !!editor?.isActive("orderedList"), quote: !!editor?.isActive("blockquote"), code: !!editor?.isActive("codeBlock"),
    link: !!editor?.isActive("link"), highlight: !!editor?.isActive("highlight"), sub: !!editor?.isActive("subscript"), sup: !!editor?.isActive("superscript"),
    left: !!editor?.isActive({ textAlign: "left" }), center: !!editor?.isActive({ textAlign: "center" }), right: !!editor?.isActive({ textAlign: "right" }), justify: !!editor?.isActive({ textAlign: "justify" }),
    font: (editor?.getAttributes("textStyle").fontFamily as string | undefined) ?? "", size: (editor?.getAttributes("textStyle").fontSize as string | undefined) ?? "",
    color: (editor?.getAttributes("textStyle").color as string | undefined) ?? "",
    words: editor?.storage.characterCount?.words?.() ?? 0,
    premium: editor ? premiumBlock(editor)?.premium ?? false : false, premiumable: editor ? premiumBlock(editor) !== null : false,
  }) });

  const disabled = sourceMode || readOnly || !editor;
  const tool = (label: string, Icon: typeof Bold, on: boolean | undefined, run: () => void) => <button key={label} type="button" title={label} aria-label={label} aria-pressed={on} disabled={disabled} onClick={run}><Icon size={16} strokeWidth={1.8} /></button>;
  const chain = () => editor!.chain().focus();

  function openPanel(next: typeof panel) {
    setFieldError("");
    if (panel === next) { setPanel(""); return; }
    setField(next === "link" ? (editor?.getAttributes("link").href as string | undefined) ?? "" : "");
    setPanel(next);
  }
  function submitPanel(event: React.FormEvent) {
    event.preventDefault();
    const value = field.trim();
    if (panel === "link") {
      if (!value) chain().extendMarkRange("link").unsetLink().run();
      else if (/^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(value)) chain().extendMarkRange("link").setLink({ href: value }).run();
      else { setFieldError("Enter an https:// URL, a site path, an email or a telephone link."); return; }
    } else if (panel === "video") {
      if (!embedFor(value)) { setFieldError("Paste a YouTube or Vimeo link."); return; }
      chain().insertContent({ type: "videoEmbed", attrs: { href: value, caption: "" } }).run();
    } else if (panel === "image") {
      if (!/^https?:\/\//i.test(value)) { setFieldError("Enter an https:// image URL or pick an attached image."); return; }
      chain().setImage({ src: value, alt: "" }).run();
    }
    setPanel("");
  }
  function switchMode() {
    setPanel(""); setFieldError("");
    if (!sourceMode) { setSourceMode(true); return; }
    if (!editor) return;
    try { editor.commands.setContent(html, { emitUpdate: false, errorOnInvalidContent: true }); }
    catch {
      if (!window.confirm("The visual editor cannot keep every element in this HTML. Switching may remove content or formatting. Continue?")) return;
      editor.commands.setContent(html, { emitUpdate: false, errorOnInvalidContent: false });
    }
    onChange(editor.getHTML(), editor.getJSON() as BlockDocument); setWarning(""); setSourceMode(false);
  }

  return <div className="ed-body">
    <div className="ed-body-toolbar" role="toolbar" aria-label="Text formatting">
      <div ref={menuRef} style={{ display: "contents" }}>
        <button type="button" title="Text style" aria-label="Text style" aria-haspopup="menu" aria-expanded={menu === "style"} disabled={disabled} onClick={() => setMenu(menu === "style" ? "" : "style")} style={{ width: "auto", padding: "0 8px", gap: 4, fontSize: 12.5, fontWeight: 500 }}><Type size={15} strokeWidth={1.8} />Style<ChevronDown size={12} /></button>
        {menu === "style" && <div className="ed-menu ed-tool-popover" role="menu" aria-label="Text style">
          <label>Font<select className="ed-select" aria-label="Font" value={FONTS.some(font => font.value === active?.font) ? active?.font ?? "" : ""} onChange={event => { if (event.target.value) chain().setFontFamily(event.target.value).run(); else chain().unsetFontFamily().run(); }}>{FONTS.map(font => <option key={font.label} value={font.value}>{font.label}</option>)}</select></label>
          <label>Size<select className="ed-select" aria-label="Size" value={active?.size ?? ""} onChange={event => { if (event.target.value) chain().setFontSize(event.target.value).run(); else chain().unsetFontSize().run(); }}>{SIZES.map(size => <option key={size || "default"} value={size}>{size || "Default"}</option>)}</select></label>
          <label>Color<span style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="color" className="ed-color-input" aria-label="Text color" value={/^#[0-9a-f]{6}$/i.test(active?.color ?? "") ? active!.color : "#171717"} onChange={event => chain().setColor(event.target.value).run()} /><button type="button" className="ed-button sm" style={{ width: "auto" }} onClick={() => chain().unsetColor().run()}>Reset</button></span></label>
          <label>Emphasis<span style={{ display: "flex", gap: 4 }}>
            <button type="button" className="ed-button sm" aria-pressed={active?.highlight} style={{ width: "auto" }} onClick={() => chain().toggleHighlight({ color: "#fff3a3" }).run()}><Highlighter size={13} /> Highlight</button>
            <button type="button" className="ed-button sm" aria-pressed={active?.strike} style={{ width: "auto" }} onClick={() => chain().toggleStrike().run()}><Strikethrough size={13} /> Strike</button>
            <button type="button" className="ed-button sm" aria-pressed={active?.sub} style={{ width: "auto" }} onClick={() => chain().toggleSubscript().run()}><SubIcon size={13} /></button>
            <button type="button" className="ed-button sm" aria-pressed={active?.sup} style={{ width: "auto" }} onClick={() => chain().toggleSuperscript().run()}><SupIcon size={13} /></button>
          </span></label>
        </div>}
      </div>
      <span className="sep" aria-hidden />
      {tool("Bold", Bold, active?.bold, () => chain().toggleBold().run())}
      {tool("Italic", Italic, active?.italic, () => chain().toggleItalic().run())}
      {tool("Underline", Underline, active?.underline, () => chain().toggleUnderline().run())}
      <span className="sep" aria-hidden />
      {tool("Heading", Heading2, active?.h2, () => chain().toggleHeading({ level: 2 }).run())}
      {tool("Subheading", Heading3, active?.h3, () => chain().toggleHeading({ level: 3 }).run())}
      {tool("Bulleted list", List, active?.bullet, () => chain().toggleBulletList().run())}
      {tool("Numbered list", ListOrdered, active?.ordered, () => chain().toggleOrderedList().run())}
      {tool("Quote", Quote, active?.quote, () => chain().toggleBlockquote().run())}
      <span className="sep" aria-hidden />
      <button type="button" title="Link" aria-label="Link" aria-pressed={active?.link || panel === "link"} disabled={disabled} onClick={() => openPanel("link")}><LinkIcon size={16} strokeWidth={1.8} /></button>
      <button type="button" title="Insert image" aria-label="Insert image" aria-pressed={panel === "image"} disabled={disabled} onClick={() => openPanel("image")}><ImagePlus size={16} strokeWidth={1.8} /></button>
      <button type="button" title="Embed video" aria-label="Embed video" aria-pressed={panel === "video"} disabled={disabled} onClick={() => openPanel("video")}><Video size={16} strokeWidth={1.8} /></button>
      <div ref={moreRef} style={{ display: "contents" }}>
        <button type="button" title="More formatting" aria-label="More formatting" aria-haspopup="menu" aria-expanded={menu === "more"} disabled={disabled} onClick={() => setMenu(menu === "more" ? "" : "more")}><MoreHorizontal size={16} strokeWidth={1.8} /></button>
        {menu === "more" && <div className="ed-menu" role="menu" aria-label="More formatting" style={{ left: "auto", right: 0 }}>
          {([
            ["Align left", AlignLeft, active?.left, () => chain().setTextAlign("left").run()],
            ["Align center", AlignCenter, active?.center, () => chain().setTextAlign("center").run()],
            ["Align right", AlignRight, active?.right, () => chain().setTextAlign("right").run()],
            ["Justify", AlignJustify, active?.justify, () => chain().setTextAlign("justify").run()],
            ["Code block", SquareCode, active?.code, () => chain().toggleCodeBlock().run()],
            ["Divider", Minus, false, () => chain().setHorizontalRule().run()],
            ["Insert table", TableIcon, false, () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()],
            ["Clear formatting", Eraser, false, () => chain().unsetAllMarks().clearNodes().run()],
            [active?.premium ? "Remove premium mark" : "Mark block as premium", Lock, active?.premium, () => { const block = editor ? premiumBlock(editor) : null; if (block) chain().updateAttributes(block.name, { premium: !block.premium }).run(); }],
          ] as const).map(([label, Icon, on, run]) => <button key={label} type="button" role="menuitemcheckbox" aria-checked={!!on} className="ed-menu-item" data-active={!!on} onClick={() => { run(); setMenu(""); }}><Icon size={15} aria-hidden /><span>{label}</span></button>)}
        </div>}
      </div>
      <span className="spacer" />
      <button type="button" title="Undo" aria-label="Undo" disabled={disabled} onClick={() => chain().undo().run()}><Undo2 size={16} strokeWidth={1.8} /></button>
      <button type="button" title="Redo" aria-label="Redo" disabled={disabled} onClick={() => chain().redo().run()}><Redo2 size={16} strokeWidth={1.8} /></button>
      <span className="sep" aria-hidden />
      <button type="button" title={sourceMode ? "Back to the visual editor" : "Edit HTML source"} aria-label="Edit HTML source" aria-pressed={sourceMode} disabled={readOnly} onClick={switchMode} style={{ width: "auto", padding: "0 8px", gap: 6, fontSize: 12, fontWeight: 500 }}><Code2 size={15} strokeWidth={1.8} /> HTML</button>
    </div>
    {warning && <div style={{ marginTop: 10 }}><Notice tone="warning">{warning}</Notice></div>}
    {panel && !sourceMode && <form style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 10 }} onSubmit={submitPanel}>
      <input className="ed-input" style={{ flex: "1 1 260px", maxWidth: 480 }} aria-label={panel === "link" ? "Link URL" : panel === "video" ? "Video URL" : "Image URL"} placeholder={panel === "link" ? "https://" : panel === "video" ? "https://www.youtube.com/watch?v=… or vimeo.com/…" : "https://…/image.jpg"} value={field} onChange={event => setField(event.target.value)} autoFocus />
      <button type="submit" className="ed-button sm primary">{panel === "link" ? "Apply link" : panel === "video" ? "Embed" : "Insert"}</button>
      <button type="button" className="ed-button sm" onClick={() => setPanel("")}>Cancel</button>
      {fieldError && <span role="alert" style={{ color: "var(--negative)", fontSize: 12.5 }}>{fieldError}</span>}
      {panel === "image" && images.length > 0 && <div style={{ flexBasis: "100%", display: "flex", gap: 8, flexWrap: "wrap" }}>
        {images.map(image => <button key={image.src} type="button" className="ed-media-tile" style={{ width: 72, height: 54, aspectRatio: "auto" }} title={image.caption || image.alt || "Insert this image"} onClick={() => { chain().setImage({ src: image.src, alt: image.alt, title: image.caption || undefined }).run(); setPanel(""); }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Presigned preview. */}
          <img src={image.preview ?? image.src} alt={image.alt} />
        </button>)}
      </div>}
    </form>}
    <div className="ed-prose" style={{ marginTop: 14 }}>
      {sourceMode ? <textarea aria-label="Story HTML" className="ed-source" value={html} spellCheck={false} readOnly={readOnly} onChange={event => onChange(event.target.value, editor?.getJSON() as BlockDocument)} /> : <EditorContent editor={editor} />}
    </div>
  </div>;
}
