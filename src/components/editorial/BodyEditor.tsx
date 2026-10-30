"use client";

import { useEffect, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { Bold, Code2, Heading2, Heading3, Italic, Link as LinkIcon, List, ListOrdered, Minus, Quote, Redo2, Strikethrough, Underline, Undo2 } from "lucide-react";
import { Notice } from "./ui";

/**
 * The story body. Rich text through TipTap; anything TipTap cannot represent
 * switches to a lossless HTML view so imported markup is never silently dropped.
 */
export function BodyEditor({ html, onChange, readOnly = false }: { html: string; onChange: (html: string) => void; readOnly?: boolean }) {
  const [sourceMode, setSourceMode] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState("");
  const [warning, setWarning] = useState("");
  const preserveSource = () => { setSourceMode(true); setLinkOpen(false); setWarning("This story contains elements the visual editor cannot preserve. Its HTML is kept exactly here; use Preview to read it."); };

  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [2, 3, 4] }, link: { openOnClick: false }, codeBlock: false }), Image, TableKit],
    content: html, immediatelyRender: false, enableContentCheck: true, editable: !readOnly,
    editorProps: { attributes: { class: "tiptap", "aria-label": "Story body", role: "textbox", "aria-multiline": "true" } },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    onContentError: preserveSource,
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!sourceMode && !readOnly, false);
    if (!sourceMode && html !== editor.getHTML()) {
      try { editor.commands.setContent(html, { emitUpdate: false, errorOnInvalidContent: true }); }
      catch {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- A rejected parse must fall back to the lossless HTML view.
        preserveSource();
      }
    }
  }, [editor, html, sourceMode, readOnly]);

  const active = useEditorState({ editor, selector: ({ editor }) => ({
    bold: !!editor?.isActive("bold"), italic: !!editor?.isActive("italic"), underline: !!editor?.isActive("underline"), strike: !!editor?.isActive("strike"),
    h2: !!editor?.isActive("heading", { level: 2 }), h3: !!editor?.isActive("heading", { level: 3 }),
    bullet: !!editor?.isActive("bulletList"), ordered: !!editor?.isActive("orderedList"), quote: !!editor?.isActive("blockquote"), link: !!editor?.isActive("link"),
  }) });

  const commands = [
    { label: "Bold", Icon: Bold, on: active?.bold, run: () => editor?.chain().focus().toggleBold().run() },
    { label: "Italic", Icon: Italic, on: active?.italic, run: () => editor?.chain().focus().toggleItalic().run() },
    { label: "Underline", Icon: Underline, on: active?.underline, run: () => editor?.chain().focus().toggleUnderline().run() },
    { label: "Strikethrough", Icon: Strikethrough, on: active?.strike, run: () => editor?.chain().focus().toggleStrike().run() },
    null,
    { label: "Heading", Icon: Heading2, on: active?.h2, run: () => editor?.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "Subheading", Icon: Heading3, on: active?.h3, run: () => editor?.chain().focus().toggleHeading({ level: 3 }).run() },
    { label: "Bulleted list", Icon: List, on: active?.bullet, run: () => editor?.chain().focus().toggleBulletList().run() },
    { label: "Numbered list", Icon: ListOrdered, on: active?.ordered, run: () => editor?.chain().focus().toggleOrderedList().run() },
    { label: "Quote", Icon: Quote, on: active?.quote, run: () => editor?.chain().focus().toggleBlockquote().run() },
    { label: "Divider", Icon: Minus, on: false, run: () => editor?.chain().focus().setHorizontalRule().run() },
    null,
    { label: "Link", Icon: LinkIcon, on: active?.link, run: () => { setLink(editor?.getAttributes("link").href || ""); setLinkError(""); setLinkOpen(value => !value); } },
  ] as const;

  function switchMode() {
    setLinkOpen(false); setLinkError("");
    if (!sourceMode) { setSourceMode(true); return; }
    if (!editor) return;
    try { editor.commands.setContent(html, { emitUpdate: false, errorOnInvalidContent: true }); }
    catch {
      if (!window.confirm("The visual editor cannot keep every element in this HTML. Switching may remove content or formatting. Continue?")) return;
      editor.commands.setContent(html, { emitUpdate: false, errorOnInvalidContent: false });
    }
    onChange(editor.getHTML()); setWarning(""); setSourceMode(false);
  }

  return <div className="ed-body">
    <div className="ed-body-toolbar" role="toolbar" aria-label="Text formatting">
      {commands.map((command, index) => command === null ? <span key={`sep-${index}`} className="sep" aria-hidden /> :
        <button key={command.label} type="button" title={command.label} aria-label={command.label} aria-pressed={command.on} disabled={sourceMode || readOnly || !editor} onClick={command.run}><command.Icon size={16} strokeWidth={1.8} /></button>)}
      <span className="spacer" />
      <button type="button" title="Undo" aria-label="Undo" disabled={sourceMode || readOnly || !editor} onClick={() => editor?.chain().focus().undo().run()}><Undo2 size={16} strokeWidth={1.8} /></button>
      <button type="button" title="Redo" aria-label="Redo" disabled={sourceMode || readOnly || !editor} onClick={() => editor?.chain().focus().redo().run()}><Redo2 size={16} strokeWidth={1.8} /></button>
      <span className="sep" aria-hidden />
      <button type="button" title={sourceMode ? "Back to the visual editor" : "Edit HTML"} aria-label="Edit HTML" aria-pressed={sourceMode} disabled={readOnly} onClick={switchMode} style={{ width: "auto", padding: "0 8px", gap: 6, fontSize: 12, fontWeight: 500 }}><Code2 size={15} strokeWidth={1.8} /> HTML</button>
    </div>
    {warning && <div style={{ marginTop: 10 }}><Notice tone="warning">{warning}</Notice></div>}
    {linkOpen && !sourceMode && <form style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 10 }} onSubmit={event => {
      event.preventDefault();
      const value = link.trim();
      if (!value) editor?.chain().focus().extendMarkRange("link").unsetLink().run();
      else if (/^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(value)) editor?.chain().focus().extendMarkRange("link").setLink({ href: value }).run();
      else { setLinkError("Enter an https:// URL, a site path, an email or a telephone link."); return; }
      setLinkOpen(false);
    }}>
      <input className="ed-input" style={{ flex: "1 1 240px", maxWidth: 420 }} aria-label="Link URL" placeholder="https://" value={link} onChange={event => setLink(event.target.value)} autoFocus />
      <button type="submit" className="ed-button sm primary">Apply link</button>
      <button type="button" className="ed-button sm" onClick={() => setLinkOpen(false)}>Cancel</button>
      {linkError && <span role="alert" style={{ color: "var(--negative)", fontSize: 12.5 }}>{linkError}</span>}
    </form>}
    <div className="ed-prose" style={{ marginTop: 14 }}>
      {sourceMode ? <textarea aria-label="Story HTML" className="ed-source" value={html} spellCheck={false} readOnly={readOnly} onChange={event => onChange(event.target.value)} /> : <EditorContent editor={editor} />}
    </div>
  </div>;
}
