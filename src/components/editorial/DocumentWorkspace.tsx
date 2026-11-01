"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, CalendarClock, Check, Clock, Crop, Eye, FileText, History, ImageIcon, Info, Layers, Palette, PenLine, Radio, RotateCcw, Save, Search, Sparkles, Star, X } from "lucide-react";
import type { CmsDocument, CmsDocumentPatch, CmsDocumentRevision, CmsJsonObject, CmsPublicationState } from "@/lib/cms/types";
import { CONTENT_TYPE_LABELS, SOURCE_SYSTEM_LABELS, reviewReasons, reviewRequired } from "@/lib/cms/organization";
import { DataError, type MediaItem } from "@/lib/editorial/data";
import type { AssistDocument } from "@/lib/editorial/assist-types";
import { cropStyle, extractPalette, type CropRect, type FocalPoint } from "@/lib/editorial/image-tools";
import type { MediaVision } from "@/lib/editorial/search-types";
import { ImageCropper, type CropSet } from "./ImageCropper";
import { Sparkline } from "./charts";
import type { ApplyAction } from "./Assistant";
import { BRAND_NAMES, diffSummary, formatDateTime, isoToLocalInput, localInputToIso, readingMinutes, relativeTime, scheduleOf, sectionOf, slugify, STATE_LABELS, stringList, stripHtml, textDiff, withSchedule, wordCount } from "@/lib/editorial/helpers";
import { rememberDocument } from "@/lib/editorial/scheduling";
import { useEditorial } from "./EditorialProvider";
import { useAsync } from "./hooks";
import { usePageTitle, useShell } from "./Shell";
import { BodyEditor, type InsertableImage } from "./BodyEditor";
import { CatalogField } from "./CatalogField";
import { NewsletterCard } from "./NewsletterCard";
import { sponsorship } from "@/lib/cms/sponsored";
import { SiteCard } from "./SiteCard";
import { useCollaboration } from "./collab/useCollaboration";
import { ACCESS_TIERS, requiredTier, type AccessTier } from "@/lib/delivery/paywall";
import { PreviewMatrix } from "./PreviewMatrix";
import { Button, Card, Empty, Field, IconButton, LinkButton, Notice, Pill, Segmented, Skeleton, SkeletonRows, Switch } from "./ui";

type Draft = Pick<CmsDocument, "title" | "byline" | "body_html" | "body_json" | "excerpt" | "slug" | "public_url" | "publication_state" | "metadata">;
type Tab = "write" | "preview" | "history" | "sources" | "media";
const DRAFT_FIELDS: (keyof Draft)[] = ["title", "byline", "body_html", "body_json", "excerpt", "slug", "public_url", "publication_state", "metadata"];

const toDraft = (doc: CmsDocument): Draft => ({ title: doc.title, byline: doc.byline, body_html: doc.body_html, body_json: doc.body_json ?? null, excerpt: doc.excerpt, slug: doc.slug, public_url: doc.public_url, publication_state: doc.publication_state, metadata: structuredClone(doc.metadata) });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const draftKey = (id: string) => `editorial-draft:${id}`;

function patchFor(document: CmsDocument, draft: Draft): CmsDocumentPatch {
  const patch: CmsDocumentPatch = {};
  for (const field of DRAFT_FIELDS) if (!same(draft[field], document[field])) (patch as Record<string, unknown>)[field] = draft[field];
  return patch;
}

function MediaThumb({ src, alt, style }: { src: string; alt: string; style?: React.CSSProperties }) {
  // eslint-disable-next-line @next/next/no-img-element -- Presigned S3 and data URLs cannot go through the image optimizer.
  return <img src={src} alt={alt} style={style} />;
}


function RailSection({ title, icon: Icon, defaultOpen = false, children }: { title: string; icon: typeof Info; defaultOpen?: boolean; children: React.ReactNode }) {
  return <details className="ed-card still ed-rail-section" open={defaultOpen || undefined}>
    <summary><span>{title}</span><Icon size={14} aria-hidden /></summary>
    <div className="ed-rail-section-body">{children}</div>
  </details>;
}

function RevisionDiff({ from, to, label }: { from: Draft; to: Draft; label: string }) {
  const segments = useMemo(() => textDiff(`${from.title}\n${from.byline}\n\n${stripHtml(from.body_html)}`, `${to.title}\n${to.byline}\n\n${stripHtml(to.body_html)}`), [from, to]);
  const summary = diffSummary(segments);
  return <div>
    <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>{label}: <span style={{ color: "var(--positive)" }}>+{summary.added}</span> / <span style={{ color: "var(--negative)" }}>−{summary.removed}</span> words</p>
    <div className="ed-diff" style={{ maxHeight: "50vh", overflow: "auto", padding: 14, border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)" }}>
      {segments.map((segment, index) => segment.type === "equal" ? <span key={index}>{segment.text}</span> : segment.type === "insert" ? <ins key={index}>{segment.text}</ins> : <del key={index}>{segment.text}</del>)}
    </div>
  </div>;
}

export function DocumentWorkspace({ id, initialTab }: { id: string; initialTab?: string }) {
  const { data, href, toast, demo, brand } = useEditorial();
  const { setDirty: setShellDirty, openAssistant, setAssistantContext } = useShell();
  const loaded = useAsync(`doc:${id}`, signal => data.getDocument(id, signal));
  const [document, setDocument] = useState<CmsDocument | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tab, setTab] = useState<Tab>(["write", "preview", "history", "sources", "media"].includes(initialTab ?? "") ? (initialTab as Tab) : "write");
  const [cropIndex, setCropIndex] = useState<number | null>(null);
  const [describing, setDescribing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; conflict?: boolean } | null>(null);
  const [recovered, setRecovered] = useState<Draft | null>(null);
  // Set whenever the page replaces the body on purpose, so the editor (and the shared document) take it even across a remount.
  const [bodyReplaced, setBodyReplaced] = useState(false);
  const bodyApplied = useCallback(() => setBodyReplaced(false), []);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [compare, setCompare] = useState<CmsDocumentRevision | null>(null);
  const [historyToken, setHistoryToken] = useState(0);
  const saveRef = useRef<() => void>(() => {});
  // Collaborative editing over Supabase Realtime in the connected workspace; the demo edits locally.
  const collab = useCollaboration(document?.id ?? null, data, !demo && !!document);

  useEffect(() => {
    if (!loaded.data) return;
    const doc = loaded.data.document;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Seed the working copy from the loaded document once.
    setDocument(doc); setDraft(toDraft(doc)); rememberDocument(doc);
    try {
      const stored = JSON.parse(window.localStorage.getItem(draftKey(doc.id)) || "null") as { revision: number; draft: Draft } | null;
      if (stored && stored.revision === doc.revision && stored.draft && !same(stored.draft, toDraft(doc))) setRecovered(stored.draft);
    } catch { /* no recovery */ }
  }, [loaded.data]);

  const dirty = !!document && !!draft && Object.keys(patchFor(document, draft)).length > 0;
  useEffect(() => { setShellDirty(dirty || saving); return () => setShellDirty(false); }, [dirty, saving, setShellDirty]);
  useEffect(() => {
    if (!document || !draft) return;
    const timer = setTimeout(() => {
      try {
        if (dirty) window.localStorage.setItem(draftKey(document.id), JSON.stringify({ revision: document.revision, draft }));
        // Keep a recoverable draft in storage until the editor chooses Restore or Discard.
        else if (!recovered) window.localStorage.removeItem(draftKey(document.id));
      } catch { /* storage unavailable */ }
    }, 600);
    return () => clearTimeout(timer);
  }, [draft, document, dirty, recovered]);
  usePageTitle(draft?.title?.trim() || (document ? "Untitled" : null));

  const update = useCallback((changes: Partial<Draft>) => setDraft(current => current ? { ...current, ...changes } : current), []);
  const updateMeta = useCallback((changes: CmsJsonObject | ((metadata: CmsJsonObject) => CmsJsonObject)) => setDraft(current => current ? { ...current, metadata: typeof changes === "function" ? changes(current.metadata) : { ...current.metadata, ...changes } } : current), []);

  const save = useCallback(async () => {
    if (!document || !draft || saving) return;
    const patch = patchFor(document, draft);
    if (!Object.keys(patch).length) return;
    if (patch.title !== undefined && !patch.title.trim() && !reviewRequired(document.metadata)) { setError({ message: "A title is required before saving." }); return; }
    setSaving(true); setError(null);
    try {
      const saved = await data.saveDocument(document.id, document.revision, patch);
      rememberDocument(saved);
      setDocument(saved);
      // Keep anything typed while the request was in flight.
      setDraft(current => {
        const base = toDraft(saved);
        if (!current) return base;
        const next = { ...base };
        for (const field of DRAFT_FIELDS) if (!same(current[field], draft[field])) (next as Record<string, unknown>)[field] = current[field];
        return next;
      });
      setLastSaved(saved.updated_at); setHistoryToken(value => value + 1);
      void collab.provider?.flush();
      toast("Saved", "success");
    } catch (failure) {
      if (failure instanceof DataError && failure.code === "revision_conflict") {
        try {
          const latest = await data.getDocument(document.id);
          setDocument(latest.document);
          setError({ message: `Another editor saved revision ${latest.document.revision}. Your edits are kept here; review them against the newer version in History, then save again.`, conflict: true });
        } catch { setError({ message: failure.message, conflict: true }); }
      } else setError({ message: failure instanceof Error ? failure.message : "The document could not be saved." });
    } finally { setSaving(false); }
  }, [document, draft, saving, data, toast, collab.provider]);
  useEffect(() => { saveRef.current = save; }, [save]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); saveRef.current(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const history = useAsync(`history:${id}:${document?.revision ?? 0}:${historyToken}`, signal => data.history(id, signal), { enabled: !!document && (tab === "history" || tab === "sources") });
  const media = useAsync(`media:${id}`, signal => data.media(id, signal), { enabled: !!document });
  const mediaMeta = useMemo(() => (Array.isArray(draft?.metadata.media) ? draft.metadata.media : []) as CmsJsonObject[], [draft]);
  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; }, [draft]);

  // The assistant reads the live draft and applies suggestions straight into it.
  useEffect(() => {
    if (!document) return;
    const getDocument = (): AssistDocument => {
      const current = draftRef.current ?? toDraft(document);
      const seo = (current.metadata.seo && typeof current.metadata.seo === "object" && !Array.isArray(current.metadata.seo) ? current.metadata.seo : {}) as CmsJsonObject;
      const items = (Array.isArray(current.metadata.media) ? current.metadata.media : []) as CmsJsonObject[];
      return {
        brand: document.brand, kind: document.kind, title: current.title, byline: current.byline, excerpt: current.excerpt, section: sectionOf(current.metadata),
        tags: stringList(current.metadata.tags), slug: current.slug, public_url: current.public_url,
        seo: { title: typeof seo.title === "string" ? seo.title : "", description: typeof seo.description === "string" ? seo.description : "" },
        body_text: stripHtml(current.body_html),
        media: items.map((item, index) => ({ index, caption: typeof item.caption === "string" ? item.caption : "", alt: typeof item.alt === "string" ? item.alt : "", credit: typeof item.credit === "string" ? item.credit : "", file: typeof item.file === "string" ? item.file : "" })),
      };
    };
    const apply = (action: ApplyAction) => {
      const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      switch (action.type) {
        case "title": update({ title: action.value }); break;
        case "excerpt": update({ excerpt: action.value }); break;
        case "slug": update({ slug: action.value }); break;
        case "seo_title": updateMeta(metadata => ({ ...metadata, seo: { ...(metadata.seo as CmsJsonObject | undefined ?? {}), title: action.value } })); break;
        case "meta_description": updateMeta(metadata => ({ ...metadata, seo: { ...(metadata.seo as CmsJsonObject | undefined ?? {}), description: action.value } })); break;
        case "keywords": updateMeta(metadata => ({ ...metadata, tags: [...new Set([...stringList(metadata.tags), ...action.value])] })); break;
        case "caption": updateMeta(metadata => ({ ...metadata, media: ((Array.isArray(metadata.media) ? metadata.media : []) as CmsJsonObject[]).map((item, index) => index === action.index ? { ...item, caption: action.caption || item.caption, alt: action.alt || item.alt } : item) })); break;
        case "direct_answer": setDraft(current => current ? { ...current, body_html: `<p><strong>${escape(action.value)}</strong></p>${current.body_html}` } : current); setBodyReplaced(true); break;
        case "faq": setDraft(current => current ? { ...current, body_html: `${current.body_html}<h2>Frequently asked questions</h2>${action.value.map(item => `<h3>${escape(item.question)}</h3><p>${escape(item.answer)}</p>`).join("")}` } : current); setBodyReplaced(true); break;
      }
    };
    setAssistantContext({ documentId: document.id, getDocument, apply });
    return () => setAssistantContext(null);
  }, [document, update, updateMeta, setAssistantContext]);

  // Insert a stable media URL, never the five-minute presigned preview; the demo's placeholders are already stable.
  // The gallery library (Morweb's galleries, kept in S3), searched by file name from the insert-image control.
  const searchLibrary = useCallback(async (query: string, signal: AbortSignal): Promise<InsertableImage[]> => {
    const page = await data.mediaFiles(brand, { q: query, status: "stored", limit: 24 }, signal);
    return page.files.filter(file => file.public_url && /^image\//.test(file.mime)).map(file => ({
      src: file.public_url!.startsWith("/") ? `${window.location.origin}${file.public_url}` : file.public_url!,
      alt: file.alt || "", caption: file.file_name, preview: file.thumb ?? undefined,
    }));
  }, [data, brand]);
  const insertable = useMemo<InsertableImage[]>(() => (media.data ?? []).filter(item => item.preview_url).map(item => ({ src: demo || !document ? item.preview_url as string : `/api/media/${document.id}/${item.index}?w=1600`, preview: item.preview_url as string, alt: item.alt ?? "", caption: item.caption ?? "" })), [media.data, demo, document]);
  const performancePath = document?.publication_state === "published" ? (document.public_url ? (() => { try { return new URL(document.public_url).pathname; } catch { return null; } })() : document.slug ? `/${document.slug}` : null) : null;
  const documentBrand = document?.brand ?? brand;
  const performance = useAsync(`performance:${id}:${documentBrand}:${performancePath}`, signal => data.pagePerformance(documentBrand, performancePath as string, 28, signal), { enabled: !!performancePath });

  const setMediaItem = useCallback((index: number, changes: CmsJsonObject | ((item: CmsJsonObject) => CmsJsonObject)) => updateMeta(metadata => ({
    ...metadata, media: ((Array.isArray(metadata.media) ? metadata.media : []) as CmsJsonObject[]).map((item, i) => i === index ? (typeof changes === "function" ? changes(item) : { ...item, ...changes }) : item),
  })), [updateMeta]);

  // Pull a palette from each preview once so images can be searched by color.
  useEffect(() => {
    const items = media.data;
    if (!items || !draft) return;
    let cancelled = false;
    (async () => {
      for (const item of items) {
        const current = (draftRef.current?.metadata.media as CmsJsonObject[] | undefined)?.[item.index];
        if (!item.preview_url || !current || Array.isArray(current.palette)) continue;
        const result = await extractPalette(item.preview_url);
        if (cancelled || !result?.palette.length) continue;
        setMediaItem(item.index, entry => ({ ...entry, palette: result.palette, palette_names: result.names.join(", ") }));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per media load
  }, [media.data]);

  async function describe(index: number) {
    if (!document) return;
    setDescribing(index);
    try {
      const vision: MediaVision = await data.describeMedia(document.id, index);
      setMediaItem(index, { vision: vision as unknown as CmsJsonObject });
      toast("Image described. Save to make it searchable.", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "The image could not be described.", "error");
    } finally { setDescribing(null); }
  }

  if (loaded.error) return <Card><Empty icon={FileText} title="This document could not be opened" text={loaded.error} action={<LinkButton href={href("/cms/library")} icon={ArrowLeft}>Back to the library</LinkButton>} /></Card>;
  if (!document || !draft) return <div className="ed-editor"><div className="ed-editor-main"><Skeleton width="60%" height={34} /><div style={{ marginTop: 24 }}><SkeletonRows rows={6} /></div></div><div className="ed-editor-rail"><Card pad="sm"><SkeletonRows rows={4} /></Card></div></div>;

  const words = wordCount(draft.body_html);
  const schedule = scheduleOf(draft.metadata);
  const gate = reviewRequired(document.metadata);
  const reasons = reviewReasons(document.metadata);
  const seo = (draft.metadata.seo && typeof draft.metadata.seo === "object" && !Array.isArray(draft.metadata.seo) ? draft.metadata.seo : {}) as CmsJsonObject;
  const rating = (draft.metadata.rating && typeof draft.metadata.rating === "object" && !Array.isArray(draft.metadata.rating) ? draft.metadata.rating : {}) as CmsJsonObject;
  const states: CmsPublicationState[] = document.publication_state === "published" ? ["published", "unpublished"] : ["draft", "review", "unpublished"];
  const tabs: { id: Tab; label: string }[] = [{ id: "write", label: "Write" }, { id: "preview", label: "Preview" }, { id: "history", label: "History" }, { id: "sources", label: "Sources" }, ...(mediaMeta.length ? [{ id: "media" as Tab, label: `Media (${mediaMeta.length})` }] : [])];
  const warnings = stringList(document.metadata.warnings);

  return <div className="ed-doc">
    <div className="ed-editor-bar">
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: "1 1 240px" }}>
          <LinkButton href={href("/cms/library")} size="sm" variant="subtle" icon={ArrowLeft}>Library</LinkButton>
          <span className="ed-doc-bar-title" title={draft.title}>{draft.title || "Untitled"}</span>
          <Pill tone={document.publication_state !== "published" && schedule ? "scheduled" : document.publication_state} />
        </div>
        <div className="ed-editor-status">
          {collab.status !== "off" && <span className="ed-presence" title={collab.status === "connected" ? `${collab.peers.length} other${collab.peers.length === 1 ? "" : "s"} editing live` : "Reconnecting to the shared document"}>
            <Radio size={13} aria-hidden style={{ color: collab.status === "connected" ? "var(--positive)" : "var(--muted)" }} />
            {collab.peers.slice(0, 4).map(peer => <span key={peer.clientId} className="ed-avatar" style={{ width: 22, height: 22, fontSize: 10, background: peer.color, color: "#fff", boxShadow: "0 0 0 2px var(--surface)" }} title={peer.name}>{peer.name.split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase()}</span>)}
            {collab.peers.length > 4 && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>+{collab.peers.length - 4}</span>}
          </span>}
          <span>{saving ? "Saving…" : dirty ? "Unsaved changes" : lastSaved ? `Saved ${relativeTime(lastSaved)}` : `Revision ${document.revision}`}</span>
          <IconButton label="Assistant (⌘J)" icon={Sparkles} ai onClick={() => openAssistant()} />
          <Button variant="primary" size="sm" icon={Save} disabled={!dirty || saving} onClick={save} title="Save (⌘S)">{saving ? "Saving…" : "Save"}</Button>
        </div>
    </div>
    <div className="ed-editor">
    <div className="ed-editor-main">
      {recovered && <div style={{ marginBottom: 12 }}><Notice icon={RotateCcw}><span>You have unsaved edits from an earlier visit to this document.</span> <button type="button" className="ed-link" onClick={() => { setDraft(recovered); setBodyReplaced(true); setRecovered(null); }}>Restore them</button> · <button type="button" className="ed-link" onClick={() => { setRecovered(null); try { window.localStorage.removeItem(draftKey(document.id)); } catch { /* ignore */ } }}>Discard</button></Notice></div>}
      {error && <div style={{ marginBottom: 12 }}><Notice tone="error" icon={X}>{error.message}{error.conflict && <> <button type="button" className="ed-link" onClick={() => setTab("history")}>Open History</button></>}</Notice></div>}
      {gate && <p className="ed-gate"><Info size={13} aria-hidden />Review required before publishing{reasons.length ? `: ${reasons.join(", ")}` : "."}</p>}
      {warnings.length > 0 && !gate && <p className="ed-gate"><Info size={13} aria-hidden />{warnings[0]}</p>}

      <div className="ed-doc-tabs"><Segmented label="Editor view" value={tab} onChange={setTab} options={tabs} /></div>

      {tab === "write" && <div className="ed-canvas">
        <textarea className="ed-title-input" rows={1} value={draft.title} placeholder="Headline" aria-label="Title" maxLength={500}
          ref={node => { if (node) { node.style.height = "auto"; node.style.height = `${node.scrollHeight}px`; } }}
          onChange={event => { update({ title: event.target.value }); event.target.style.height = "auto"; event.target.style.height = `${event.target.scrollHeight}px`; }} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} />
        <input className="ed-byline-input" style={{ marginTop: 8 }} value={draft.byline} placeholder="Byline" aria-label="Byline" maxLength={1000} onChange={event => update({ byline: event.target.value })} />
        {collab.ready
          ? <BodyEditor key={`${document.id}:${collab.status === "off" ? document.revision : "live"}`} html={draft.body_html} onChange={(body_html, body_json) => update({ body_html, body_json: body_json as unknown as CmsJsonObject })} images={insertable} searchLibrary={searchLibrary} applyHtml={bodyReplaced} onHtmlApplied={bodyApplied}
              collab={collab.status !== "off" ? { doc: collab.doc, provider: collab.provider, user: collab.user } : undefined} />
          : <div style={{ marginTop: 14 }}><SkeletonRows rows={4} /></div>}
        <p className="ed-editor-foot"><PenLine size={12} aria-hidden />{words.toLocaleString()} words · {readingMinutes(words)} min read · {CONTENT_TYPE_LABELS[document.kind].singular} · {SOURCE_SYSTEM_LABELS[document.source_system].short}</p>
      </div>}

      {tab === "preview" && <div style={{ marginTop: 16 }}><PreviewMatrix payload={{ title: draft.title, byline: draft.byline, excerpt: draft.excerpt, section: sectionOf(draft.metadata), html: draft.body_html, brand: document.brand, brandName: BRAND_NAMES[document.brand] }} /></div>}

      {tab === "history" && <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
        {history.loading && !history.data ? <SkeletonRows rows={4} /> : history.error ? <Notice tone="error">{history.error}</Notice> : <>
          {compare ? <Card>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
              <strong style={{ fontSize: 14 }}>Revision {compare.revision} <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {compare.actor} · {formatDateTime(compare.created_at)}</span></strong>
              <div style={{ display: "flex", gap: 8 }}>
                <Button size="sm" icon={RotateCcw} onClick={() => { const snapshot = compare.snapshot; setDraft(current => current ? { ...current, title: snapshot.title, byline: snapshot.byline, body_html: snapshot.body_html, excerpt: snapshot.excerpt, slug: snapshot.slug, public_url: snapshot.public_url, metadata: { ...snapshot.metadata, review: current.metadata.review ?? snapshot.metadata.review } } : current); setBodyReplaced(true); setTab("write"); toast(`Revision ${compare.revision} restored to your draft. Save to keep it.`); }}>Restore to draft</Button>
                <Button size="sm" variant="subtle" icon={X} onClick={() => setCompare(null)}>Close</Button>
              </div>
            </div>
            <RevisionDiff from={toDraft(compare.snapshot)} to={draft} label={`Changes from revision ${compare.revision} to your draft`} />
          </Card> : null}
          <Card>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Revisions</h3>
            <div className="ed-timeline">
              {(history.data?.revisions ?? []).map(revision => <div key={revision.id} className="ed-timeline-item" data-current={revision.revision === document.revision}>
                <span className="ed-timeline-dot" aria-hidden />
                <button type="button" onClick={() => setCompare(revision)} aria-pressed={compare?.id === revision.id}>
                  <strong>Revision {revision.revision}{revision.revision === document.revision ? " · current" : ""}</strong>
                  <small>{revision.reason === "ingest" ? "Imported" : "Edited"} by {revision.actor} · {formatDateTime(revision.created_at)}</small>
                </button>
              </div>)}
              {!history.data?.revisions.length && <p style={{ fontSize: 13, color: "var(--muted)" }}>No revisions recorded yet.</p>}
            </div>
          </Card>
        </>}
      </div>}

      {tab === "sources" && <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        {history.loading && !history.data ? <SkeletonRows rows={3} /> : history.error ? <Notice tone="error">{history.error}</Notice> : history.data?.sources.length ? history.data.sources.map(source => <Card key={source.id}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <strong style={{ fontSize: 14 }}>{source.is_candidate ? "Newer source candidate" : "Original source"}</strong>
              <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{formatDateTime(source.created_at)} · {source.source_hash.slice(0, 12)}…</p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {source.is_candidate && <Pill tone="review">Changed since import</Pill>}
              <Button size="sm" icon={Check} onClick={() => { update({ title: source.title, byline: source.byline, body_html: source.body_html }); setBodyReplaced(true); setTab("write"); toast("Source text copied into your draft. Save to keep it."); }}>Adopt into draft</Button>
            </div>
          </div>
          <div style={{ marginTop: 12 }}><RevisionDiff from={{ ...draft, title: source.title, byline: source.byline, body_html: source.body_html }} to={draft} label="Differences between this source and your draft" /></div>
        </Card>) : <Empty icon={Layers} title="No source snapshots" text="Imported and print documents keep the original source text here so edits can always be compared with it." />}
        {!demo && document.source_system === "morweb" && <Notice>Raw archive records for this Morweb document are available to administrators through the migration inventory.</Notice>}
      </div>}

      {tab === "media" && <div style={{ marginTop: 16 }}>
        {media.loading && !media.data ? <SkeletonRows rows={3} /> : media.error ? <Notice tone="error">{media.error}</Notice> : <div style={{ display: "grid", gap: 12 }}>
          {mediaMeta.map((item, index) => {
            const preview = media.data?.find(entry => entry.index === index) ?? (null as MediaItem | null);
            const set = (changes: CmsJsonObject) => updateMeta(metadata => ({ ...metadata, media: mediaMeta.map((entry, i) => i === index ? { ...entry, ...changes } : changes.is_lead === true ? { ...entry, is_lead: false } : entry) }));
            const crops = (item.crops && typeof item.crops === "object" && !Array.isArray(item.crops) ? item.crops : {}) as Record<string, CropRect>;
            const vision = (item.vision && typeof item.vision === "object" && !Array.isArray(item.vision) ? item.vision : null) as MediaVision | null;
            const palette = Array.isArray(item.palette) ? (item.palette as string[]) : [];
            const cropCount = Object.keys(crops).length;
            return <Card key={index} pad="sm">
              <div style={{ display: "grid", gridTemplateColumns: "96px 1fr", gap: 14, alignItems: "start" }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <button type="button" className="ed-media-tile" data-lead={item.is_lead === true} style={{ aspectRatio: "4 / 3", cursor: preview?.preview_url ? "zoom-in" : "default" }} onClick={() => preview?.preview_url && setCropIndex(index)} title={preview?.preview_url ? "Crop this image" : "No preview available"}>
                    {preview?.preview_url ? <MediaThumb src={preview.preview_url} alt={typeof item.alt === "string" ? item.alt : ""} style={cropStyle(crops["4:3"] ?? crops["3:2"] ?? crops["16:9"] ?? null)} /> : <span style={{ position: "static", display: "grid", placeItems: "center", height: "100%", background: "transparent", color: "var(--muted)" }}><ImageIcon size={20} aria-hidden /></span>}
                    {item.is_lead === true && <span>Lead</span>}
                  </button>
                  {palette.length > 0 && <span className="ed-swatches" title={typeof item.palette_names === "string" ? item.palette_names : ""} aria-label={`Palette: ${typeof item.palette_names === "string" ? item.palette_names : ""}`}>{palette.slice(0, 4).map(color => <i key={color} style={{ background: color }} />)}</span>}
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{typeof item.file === "string" ? item.file : `Image ${index + 1}`}{cropCount ? ` · ${cropCount} crop${cropCount === 1 ? "" : "s"}` : ""}</span>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>Lead image <Switch checked={item.is_lead === true} onChange={next => set({ is_lead: next })} label={`Use image ${index + 1} as the lead`} /></label>
                  </div>
                  <input className="ed-input" placeholder="Caption" aria-label="Caption" value={typeof item.caption === "string" ? item.caption : ""} onChange={event => set({ caption: event.target.value })} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <input className="ed-input" placeholder="Credit" aria-label="Credit" value={typeof item.credit === "string" ? item.credit : ""} onChange={event => set({ credit: event.target.value })} />
                    <input className="ed-input" placeholder="Alt text" aria-label="Alt text" value={typeof item.alt === "string" ? item.alt : ""} onChange={event => set({ alt: event.target.value })} />
                  </div>
                  {vision && <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5, margin: 0 }}>{vision.description} <span style={{ color: "var(--muted-soft)" }}>· {vision.style}</span></p>}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 2, marginLeft: -8 }}>
                    <Button size="sm" variant="subtle" icon={Crop} disabled={!preview?.preview_url} onClick={() => setCropIndex(index)}>Crop</Button>
                    <Button size="sm" variant="subtle" icon={Sparkles} disabled={describing !== null} onClick={() => describe(index)}>{describing === index ? "Describing…" : vision ? "Describe again" : "Describe for search"}</Button>
                    {!palette.length && preview?.preview_url && <Button size="sm" variant="subtle" icon={Palette} onClick={async () => { const result = await extractPalette(preview.preview_url as string); if (result?.palette.length) set({ palette: result.palette, palette_names: result.names.join(", ") }); else toast("The palette could not be read from this image.", "error"); }}>Palette</Button>}
                  </div>
                </div>
              </div>
            </Card>;
          })}
        </div>}
        <ImageCropper key={cropIndex ?? "none"} open={cropIndex !== null} onClose={() => setCropIndex(null)} title={draft.title}
          src={cropIndex !== null ? media.data?.find(entry => entry.index === cropIndex)?.preview_url ?? null : null}
          crops={cropIndex !== null ? ((mediaMeta[cropIndex]?.crops && typeof mediaMeta[cropIndex].crops === "object" ? mediaMeta[cropIndex].crops : {}) as CropSet) : {}}
          focal={cropIndex !== null && mediaMeta[cropIndex]?.focal && typeof mediaMeta[cropIndex].focal === "object" ? (mediaMeta[cropIndex].focal as FocalPoint) : null}
          onSave={(crops, focal) => { if (cropIndex !== null) { setMediaItem(cropIndex, { crops: crops as unknown as CmsJsonObject, focal: focal as unknown as CmsJsonObject }); toast("Crops saved to the draft. Save to keep them.", "success"); } }} />
      </div>}
    </div>

    <aside className="ed-editor-rail">
      <Card pad={false} className="ed-rail-card still">
        <h3>Publishing <Clock size={14} aria-hidden /></h3>
        <Field label="State" htmlFor="ed-state">
          <select id="ed-state" className="ed-select" value={draft.publication_state} onChange={event => update({ publication_state: event.target.value as CmsPublicationState })}>
            {states.map(state => <option key={state} value={state}>{STATE_LABELS[state]}</option>)}
          </select>
          {document.publication_state !== "published" && <small>New content cannot publish from this workspace yet. Set a planned time and send it to review.</small>}
        </Field>
        <Field label="Planned publish time" htmlFor="ed-schedule" hint={schedule ? `Shows on the calendar · ${relativeTime(schedule.publish_at)}` : "Optional. Appears on the schedule and the home desk."}>
          <div style={{ display: "flex", gap: 6 }}>
            <input id="ed-schedule" type="datetime-local" className="ed-input" value={isoToLocalInput(schedule?.publish_at)} onChange={event => { const iso = localInputToIso(event.target.value); updateMeta(metadata => withSchedule(metadata, iso ? { publish_at: iso, ...(schedule?.note ? { note: schedule.note } : {}) } : null)); }} />
            {schedule && <Button size="sm" variant="subtle" icon={X} aria-label="Clear planned time" onClick={() => updateMeta(metadata => withSchedule(metadata, null))} />}
          </div>
        </Field>
        <Field label="Reader access" htmlFor="ed-access" hint={requiredTier(draft.metadata) === "free" ? "Everyone can read it. Mark single blocks premium from the editor’s More menu." : "Readers below this tier see the lede and premium blocks are removed at the edge."}>
          <select id="ed-access" className="ed-select" value={requiredTier(draft.metadata)} onChange={event => updateMeta({ access: { tier: event.target.value as AccessTier } })}>
            {ACCESS_TIERS.map(tier => <option key={tier} value={tier}>{tier === "free" ? "Free" : tier === "registered" ? "Registered readers" : "Subscribers"}</option>)}
          </select>
        </Field>
        {document.published_at && <p style={{ marginTop: 12, fontSize: 12.5, color: "var(--muted)" }}><CalendarClock size={12} aria-hidden style={{ verticalAlign: -1, marginRight: 4 }} />Published {formatDateTime(document.published_at)}</p>}
      </Card>

      <Card pad={false} className="ed-rail-card still">
        <h3>Story <Info size={14} aria-hidden /></h3>
        <Field label="Section" htmlFor="ed-section"><input id="ed-section" className="ed-input" value={sectionOf(draft.metadata)} onChange={event => updateMeta({ section: event.target.value, categories: event.target.value ? [event.target.value] : [] })} placeholder="News, Features, Ratings…" /></Field>
        <Field label="Summary" htmlFor="ed-excerpt" hint="Shown in lists and feeds."><textarea id="ed-excerpt" className="ed-textarea" rows={3} maxLength={5000} value={draft.excerpt} onChange={event => update({ excerpt: event.target.value })} /></Field>
        <Field label="Slug" htmlFor="ed-slug" hint="Lowercase and hyphenated. Existing URLs stay put until a route decision.">
          <div style={{ display: "flex", gap: 6 }}>
            <input id="ed-slug" className="ed-input" value={draft.slug ?? ""} onChange={event => update({ slug: event.target.value })} placeholder="story-slug" />
            <Button size="sm" variant="subtle" onClick={() => update({ slug: slugify(draft.title) })} title="Generate from the title">Auto</Button>
          </div>
        </Field>
        <Field label="Public URL" htmlFor="ed-url"><input id="ed-url" className="ed-input" type="url" value={draft.public_url ?? ""} onChange={event => update({ public_url: event.target.value })} placeholder="https://" /></Field>
        <Field label="Tags" htmlFor="ed-tags" hint="Comma separated."><input id="ed-tags" className="ed-input" value={stringList(draft.metadata.tags).join(", ")} onChange={event => updateMeta({ tags: event.target.value.split(",").map(tag => tag.trim()).filter(Boolean) })} placeholder="Bourbon, Collecting" /></Field>
        {document.kind === "article" && (() => {
          const sp = sponsorship(draft.metadata, draft.byline);
          return <Field label="Sponsored" htmlFor="ed-sponsored" hint={sp.on ? "Labeled Sponsored in every feed on the site, with a disclosure at the top of the story." : sp.explicit ? "Marked not sponsored. Legacy byline or tags are ignored." : "Paid content gets a Sponsored label in feeds and a disclosure on the story."}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}><input id="ed-sponsored" type="checkbox" className="ed-checkbox" checked={sp.on} onChange={event => updateMeta({ sponsored: { on: event.target.checked, by: sp.by } })} />This is sponsored content</label>
            {sp.on && <input className="ed-input" style={{ marginTop: 8 }} aria-label="Sponsor" value={sp.by} onChange={event => updateMeta({ sponsored: { on: true, by: event.target.value } })} placeholder="Sponsor, shown as “Sponsored by …” (optional)" />}
          </Field>;
        })()}
      </Card>

      {document.kind === "rating" || document.kind === "product_review" ? <Card pad={false} className="ed-rail-card still">
        <h3>Rating <Star size={14} aria-hidden /></h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <Field label="Score" htmlFor="ed-score"><input id="ed-score" className="ed-input" type="number" min={0} max={100} value={typeof rating.score === "number" ? rating.score : ""} onChange={event => updateMeta({ rating: { ...rating, score: event.target.value === "" ? null : Number(event.target.value) } })} /></Field>
          <Field label="Price" htmlFor="ed-price"><input id="ed-price" className="ed-input" type="number" min={0} step="0.01" value={typeof rating.price === "number" ? rating.price : ""} onChange={event => updateMeta({ rating: { ...rating, price: event.target.value === "" ? null : Number(event.target.value) } })} /></Field>
          <Field label="Vintage" htmlFor="ed-vintage"><input id="ed-vintage" className="ed-input" type="number" min={1800} max={2100} value={typeof rating.vintage === "number" ? rating.vintage : ""} onChange={event => updateMeta({ rating: { ...rating, vintage: event.target.value === "" ? null : Number(event.target.value) } })} /></Field>
        </div>
        <CatalogField type="producer" value={typeof rating.producer === "string" ? rating.producer : typeof rating.brand === "string" ? rating.brand : ""} onChange={value => updateMeta({ rating: { ...rating, producer: value } })} placeholder="Winery, distillery or maker" hint="Joins the producer record so every rating of theirs stays linked." />
        <CatalogField type="region" value={typeof rating.region === "string" ? rating.region : ""} onChange={value => updateMeta({ rating: { ...rating, region: value } })} placeholder="Appellation or region" />
        <CatalogField type="variety" value={typeof rating.variety === "string" ? rating.variety : ""} onChange={value => updateMeta({ rating: { ...rating, variety: value } })} placeholder="Grape, grain, style or wrapper" />
        <CatalogField type="taster" value={typeof rating.taster === "string" ? rating.taster : typeof rating.reviewer === "string" ? rating.reviewer : ""} onChange={value => updateMeta({ rating: { ...rating, taster: value } })} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Category" htmlFor="ed-rating-category"><input id="ed-rating-category" className="ed-input" value={typeof rating.category === "string" ? rating.category : ""} onChange={event => updateMeta({ rating: { ...rating, category: event.target.value } })} placeholder="Bourbon, Cabernet…" /></Field>
          <Field label="Drink window" htmlFor="ed-rating-window"><input id="ed-rating-window" className="ed-input" value={typeof rating.drink_window === "string" ? rating.drink_window : ""} onChange={event => updateMeta({ rating: { ...rating, drink_window: event.target.value } })} placeholder="Now through 2035" /></Field>
        </div>
      </Card> : null}

      <NewsletterCard key={`newsletter:${document.id}`} document={document} dirty={dirty} />

      <RailSection title="Search" icon={Search}>
        <Field label="Search title" htmlFor="ed-seo-title" hint={`${String(seo.title ?? "").length}/60`}><input id="ed-seo-title" className="ed-input" maxLength={120} value={typeof seo.title === "string" ? seo.title : ""} onChange={event => updateMeta({ seo: { ...seo, title: event.target.value } })} placeholder={draft.title} /></Field>
        <Field label="Search description" htmlFor="ed-seo-description" hint={`${String(seo.description ?? "").length}/160`}><textarea id="ed-seo-description" className="ed-textarea" rows={3} maxLength={320} value={typeof seo.description === "string" ? seo.description : ""} onChange={event => updateMeta({ seo: { ...seo, description: event.target.value } })} placeholder={draft.excerpt} /></Field>
        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12, fontSize: 13 }}>Hide from search engines <Switch checked={seo.no_index === true} onChange={next => updateMeta({ seo: { ...seo, no_index: next } })} label="Hide from search engines" /></label>
      </RailSection>

      <SiteCard document={document} />

      {performancePath && <Card pad={false} className="ed-rail-card still">
        <h3>Performance <Activity size={14} aria-hidden /></h3>
        {performance.loading && !performance.data ? <SkeletonRows rows={2} /> : performance.error ? <p style={{ fontSize: 12.5, color: "var(--muted)" }}>{/connected|setup/i.test(performance.error) ? <>Connect Google Analytics on the <Link className="ed-link" href={href("/cms/audience")}>Audience page</Link> to see this story&rsquo;s readers.</> : performance.error}</p> : performance.data && <div className="ed-perf">
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
            <div><strong style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>{performance.data.pageViews.toLocaleString()}</strong><div style={{ fontSize: 12, color: "var(--muted)" }}>page views, 28 days{performance.data.source === "sample" ? " · sample" : ""}</div></div>
            <Sparkline values={performance.data.daily.map(day => day.pageViews)} color={`var(--chart-${documentBrand})`} />
          </div>
          <div className="ed-perf-row"><span>Sessions</span><b>{performance.data.sessions.toLocaleString()}</b></div>
          <div className="ed-perf-row"><span>Engagement rate</span><b>{Math.round(performance.data.engagementRate * 100)}%</b></div>
          <div className="ed-perf-row"><span>Avg. engagement</span><b>{Math.floor(performance.data.avgEngagementSeconds / 60)}m {Math.round(performance.data.avgEngagementSeconds % 60)}s</b></div>
          <div className="ed-perf-row"><span>Path</span><b style={{ fontWeight: 400, overflowWrap: "anywhere", textAlign: "right" }}>{performance.data.path}</b></div>
        </div>}
      </Card>}

      <RailSection title="Details" icon={History}>
        <dl className="ed-props">
          <div><dt>Type</dt><dd>{CONTENT_TYPE_LABELS[document.kind].singular}</dd></div>
          <div><dt>Source</dt><dd title={SOURCE_SYSTEM_LABELS[document.source_system].detail}>{SOURCE_SYSTEM_LABELS[document.source_system].short}</dd></div>
          {document.issue_uuid && <div><dt>Print issue</dt><dd><Link className="ed-link" href={href("/cms/library", { issue: document.issue_uuid })}>{typeof document.metadata.issue_label === "string" && document.metadata.issue_label ? document.metadata.issue_label : "Open issue"}</Link></dd></div>}
          <div><dt>Revision</dt><dd>{document.revision}</dd></div>
          <div><dt>Created</dt><dd>{formatDateTime(document.created_at)}</dd></div>
          <div><dt>Updated</dt><dd>{formatDateTime(document.updated_at)}</dd></div>
          <div><dt>Publication</dt><dd style={{ textTransform: "uppercase" }}>{brand}</dd></div>
        </dl>
        <div style={{ marginTop: 12 }}><Button size="sm" variant="subtle" icon={Eye} onClick={() => setTab("preview")}>Preview</Button></div>
      </RailSection>
    </aside>
    </div>
  </div>;
}
