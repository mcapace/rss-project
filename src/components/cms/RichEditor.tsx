"use client";

import { useEffect, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { Bold, Italic, Underline, Heading2, List, ListOrdered, Quote, Link as LinkIcon, Undo2, Redo2, Code2 } from "lucide-react";

export function RichEditor({ html, onChange }: { html: string; onChange: (html: string) => void }) {
  const [sourceMode, setSourceMode] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const [formatWarning, setFormatWarning] = useState("");
  const [linkError, setLinkError] = useState("");
  function preserveSource() {
    setSourceMode(true); setLinkOpen(false);
    setFormatWarning("This story contains elements the visual editor cannot preserve. Its HTML is retained here; Preview shows the story.");
  }
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [2, 3, 4] }, link: { openOnClick: false }, codeBlock: false }), Image, TableKit],
    content: html, immediatelyRender: false, enableContentCheck: true,
    editorProps: { attributes: { class: "cms-prose cms-editable", "aria-label": "Article body", role: "textbox", "aria-multiline": "true" } },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    onContentError: preserveSource,
  });
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!sourceMode, false);
    if (!sourceMode && html !== editor.getHTML()) {
      try { editor.commands.setContent(html, { emitUpdate: false, errorOnInvalidContent: true }); }
      catch {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- A rejected parse in the external Tiptap editor must switch to the lossless HTML view.
        preserveSource();
      }
    }
  }, [editor, html, sourceMode]);
  const active = useEditorState({ editor, selector: ({ editor }) => ({ bold: !!editor?.isActive("bold"), italic: !!editor?.isActive("italic"), underline: !!editor?.isActive("underline"), heading: !!editor?.isActive("heading"), bullet: !!editor?.isActive("bulletList"), ordered: !!editor?.isActive("orderedList"), quote: !!editor?.isActive("blockquote") }) });
  const commands = [
    { label: "Bold", Icon: Bold, active: active?.bold, run: () => editor?.chain().focus().toggleBold().run() },
    { label: "Italic", Icon: Italic, active: active?.italic, run: () => editor?.chain().focus().toggleItalic().run() },
    { label: "Underline", Icon: Underline, active: active?.underline, run: () => editor?.chain().focus().toggleUnderline().run() },
    { label: "Heading", Icon: Heading2, active: active?.heading, run: () => editor?.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "Bulleted list", Icon: List, active: active?.bullet, run: () => editor?.chain().focus().toggleBulletList().run() },
    { label: "Numbered list", Icon: ListOrdered, active: active?.ordered, run: () => editor?.chain().focus().toggleOrderedList().run() },
    { label: "Quote", Icon: Quote, active: active?.quote, run: () => editor?.chain().focus().toggleBlockquote().run() },
  ];
  function switchMode() {
    setLinkOpen(false); setLinkError("");
    if (!sourceMode) { setSourceMode(true); return; }
    if (!editor) return;
    try { editor.commands.setContent(html, { emitUpdate: false, errorOnInvalidContent: true }); }
    catch {
      if (!window.confirm("The visual editor cannot preserve every element in this HTML. Switching may remove content or formatting. Continue?")) return;
      editor.commands.setContent(html, { emitUpdate: false, errorOnInvalidContent: false });
    }
    onChange(editor.getHTML()); setFormatWarning(""); setSourceMode(false);
  }
  return <div className="cms-rich-editor">
    <div className="cms-editor-toolbar" role="toolbar" aria-label="Text formatting">
      {commands.map(({ label, Icon, active, run }) => <button key={label} type="button" title={label} aria-label={label} aria-pressed={active} disabled={sourceMode || !editor} onClick={run}><Icon size={17} /></button>)}
      <span className="cms-toolbar-divider" />
      <button type="button" title="Add link" aria-label="Add link" disabled={sourceMode || !editor} onClick={() => { setLink(editor?.getAttributes("link").href || ""); setLinkError(""); setLinkOpen(!linkOpen); }}><LinkIcon size={17} /></button>
      <button type="button" title="Undo" aria-label="Undo" disabled={sourceMode || !editor} onClick={() => editor?.chain().focus().undo().run()}><Undo2 size={17} /></button>
      <button type="button" title="Redo" aria-label="Redo" disabled={sourceMode || !editor} onClick={() => editor?.chain().focus().redo().run()}><Redo2 size={17} /></button>
      <button type="button" className="cms-source-switch" aria-pressed={sourceMode} onClick={switchMode}><Code2 size={16} /> HTML</button>
    </div>
    {formatWarning && <p className="cms-alert" role="status">{formatWarning}</p>}
    {linkOpen && !sourceMode && <form className="cms-link-form" onSubmit={event => { event.preventDefault(); const href = link.trim(); if (!href) editor?.chain().focus().extendMarkRange("link").unsetLink().run(); else if (/^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(href)) editor?.chain().focus().extendMarkRange("link").setLink({ href }).run(); else { setLinkError("Enter an https:// URL, site path, email, or telephone link."); return; } setLinkOpen(false); }}><input aria-label="Link URL" placeholder="https://" value={link} onChange={e => setLink(e.target.value)} /><button className="cms-button small" type="submit">Apply link</button><button className="cms-button subtle small" type="button" onClick={() => setLinkOpen(false)}>Cancel</button>{linkError && <span role="alert">{linkError}</span>}</form>}
    {sourceMode ? <textarea aria-label="Article HTML" className="cms-source-textarea" value={html} spellCheck={false} onChange={e => onChange(e.target.value)} /> : <EditorContent editor={editor} />}
  </div>;
}
