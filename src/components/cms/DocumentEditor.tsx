"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Save, Eye, PencilLine, History, Image as ImageIcon, FileClock, ChevronDown, AlertCircle, RotateCcw, ExternalLink } from "lucide-react";
import type { CmsDocument, CmsDocumentPatch, CmsDocumentRevision, CmsJson, CmsJsonObject } from "@/lib/cms/types";
import { CONTENT_TYPE_LABELS, PLACEMENT_LABELS, documentOrganization, preserveReviewGate, reviewReasons, reviewRequired, validateOrganization, type CmsPlacement } from "@/lib/cms/organization";
import { RichEditor } from "./RichEditor";
import { ArticlePreview } from "./ArticlePreview";
import { MigrationSources } from "./MigrationSources";

export interface SourceReview {
  id: string; source_hash: string; created_at: string; is_candidate: boolean;
  title: string; byline: string; body_html: string; metadata: CmsJsonObject;
}
export interface HistoryData { revisions: CmsDocumentRevision[]; sources: SourceReview[]; }

function object(value: CmsJson | undefined): CmsJsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function date(value: string) { return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
const editableFields = ["title", "byline", "body_html", "excerpt", "slug", "public_url", "publication_state", "metadata"] as const;

// A save response may arrive after the editor has made another change. Rebase
// only the submitted fields; the newer local edits must remain unsaved.
function retainNewEdits(base: CmsDocument, saved: CmsDocument, current: CmsDocument): CmsDocument {
  const changes: CmsDocumentPatch = {};
  for (const key of editableFields) {
    if (JSON.stringify(current[key]) !== JSON.stringify(base[key])) Object.assign(changes, { [key]: current[key] });
  }
  return { ...saved, ...changes };
}
function mediaKey(item: CmsJsonObject) { return String(item.s3_key || item.sha256 || item.file || ""); }

export function DocumentEditor({ document, demo, onClose, onSave, onDirtyChange, loadHistory }: {
  document: CmsDocument; demo: boolean; onClose: () => void;
  onSave: (patch: CmsDocumentPatch) => Promise<CmsDocument>;
  onDirtyChange: (dirty: boolean) => void;
  loadHistory: () => Promise<HistoryData>;
}) {
  const [draft, setDraft] = useState(document);
  const [tab, setTab] = useState<"content" | "media" | "sources" | "history">("content");
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [contentEpoch, setContentEpoch] = useState(0);
  const [mediaResult, setMediaResult] = useState<{ identity: string; urls: Record<string, string>; error: string }>({ identity: "", urls: {}, error: "" });
  const [selectedRevision, setSelectedRevision] = useState<CmsDocumentRevision | null>(null);
  const previousDocument = useRef(document);
  const savePending = useRef(false);
  const patch = useMemo(() => {
    const changes: Record<string, unknown> = {};
    for (const key of editableFields) {
      if (JSON.stringify(draft[key]) !== JSON.stringify(document[key])) changes[key] = draft[key];
    }
    return changes as CmsDocumentPatch;
  }, [draft, document]);
  const dirty = Object.keys(patch).length > 0;
  const wordCount = draft.body_html.replace(/<[^>]*>/g, " ").trim().split(/\s+/).filter(Boolean).length;
  const rating = object(draft.metadata.rating);
  const seo = object(draft.metadata.seo);
  const migration = object(draft.metadata.migration);
  const sourcePublicUrl = document.public_url || (typeof migration.source_public_url === "string" ? migration.source_public_url : null);
  const organization = documentOrganization(draft.metadata);
  const needsReview = reviewRequired(draft.metadata);
  const findings = reviewReasons(draft.metadata);
  const maySaveTitle = !!draft.title.trim() || needsReview;
  const media = Array.isArray(draft.metadata.media) ? draft.metadata.media : [];
  const mediaIdentity = JSON.stringify([document.id, document.revision, ...media.map(value => mediaKey(object(value)))]);
  const mediaUrls = mediaResult.identity === mediaIdentity ? mediaResult.urls : {};
  const mediaError = mediaResult.identity === mediaIdentity ? mediaResult.error : "";

  useEffect(() => {
    const previous = previousDocument.current;
    previousDocument.current = document;
    setDraft(current => current.id === document.id ? retainNewEdits(previous, document, current) : document);
  }, [document]);
  useEffect(() => { onDirtyChange(dirty || saving); return () => onDirtyChange(false); }, [dirty, saving, onDirtyChange]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (dirty || saving) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty, saving]);
  useEffect(() => {
    if (tab !== "sources" && tab !== "history") return;
    let current = true;
    loadHistory().then(data => { if (current) { setHistory(data); setHistoryError(""); } }).catch(err => { if (current) setHistoryError(err instanceof Error ? err.message : "History could not be loaded."); });
    return () => { current = false; };
  }, [tab, loadHistory, document.revision]);
  useEffect(() => {
    if (tab !== "media" || demo) return;
    const controller = new AbortController();
    fetch(`/api/cms/documents/${document.id}/media`, { signal: controller.signal }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Image previews could not be loaded.");
      if (!controller.signal.aborted) setMediaResult({ identity: mediaIdentity, urls: Object.fromEntries((body.media || []).map((item: CmsJsonObject) => [mediaKey(item), item.preview_url])), error: "" });
    }).catch(err => { if (!controller.signal.aborted) setMediaResult({ identity: mediaIdentity, urls: {}, error: err.message }); });
    return () => controller.abort();
  }, [tab, document.id, document.revision, mediaIdentity, demo]);

  function update(key: keyof CmsDocumentPatch, value: unknown) {
    setDraft(previous => ({ ...previous, [key]: value })); setSaved(false);
  }
  function meta(key: string, value: CmsJson) { setDraft(previous => ({ ...previous, metadata: { ...previous.metadata, [key]: value } })); setSaved(false); }
  function updatePlacement(index: number, change: Partial<Pick<CmsPlacement, "status" | "starts_at" | "ends_at">>) {
    meta("organization", { ...organization, placements: organization.placements.map((item, itemIndex) => itemIndex === index ? { ...item, ...change } : item) });
  }
  function addPlacement() {
    const slot = (Object.keys(PLACEMENT_LABELS) as CmsPlacement["slot"][]).find(key => !organization.placements.some(item => item.slot === key));
    if (slot) meta("organization", { ...organization, placements: [...organization.placements, { slot, label: PLACEMENT_LABELS[slot], status: "needs_review", starts_at: null, ends_at: null }] });
  }
  async function save() {
    if (savePending.current || !dirty || !maySaveTitle) return;
    try { if (draft.metadata.organization !== undefined) validateOrganization(draft.metadata.organization); }
    catch (err) { setError(err instanceof Error ? err.message : "Check the organization settings."); return; }
    savePending.current = true;
    const submitted = draft;
    setSaving(true); setError("");
    try { const next = await onSave(patch); setDraft(current => retainNewEdits(submitted, next, current)); setSaved(true); setHistory(null); setHistoryError(""); setSelectedRevision(null); }
    catch (err) { setError(err instanceof Error ? err.message : "Your changes could not be saved."); }
    finally { savePending.current = false; setSaving(false); }
  }
  function adopt(source: SourceReview) {
    if ((dirty || saving) && !window.confirm("Replace your unsaved headline, byline, and story text with this source? Other fields will be kept.")) return;
    setDraft(previous => ({ ...previous, title: source.title, byline: source.byline, body_html: source.body_html }));
    setContentEpoch(value => value + 1); setTab("content"); setPreview(false); setSaved(false);
  }
  function restore(version: CmsDocumentRevision) {
    if ((dirty || saving) && !window.confirm("Replace your unsaved text and metadata with this saved version? Editorial status will stay unchanged.")) return;
    const prior = version.snapshot;
    setDraft(previous => ({ ...previous, title: prior.title, byline: prior.byline, body_html: prior.body_html, excerpt: prior.excerpt, slug: prior.slug, public_url: prior.public_url, metadata: preserveReviewGate(previous.metadata, prior.metadata) }));
    setContentEpoch(value => value + 1); setTab("content"); setPreview(false); setSaved(false); setSelectedRevision(null);
  }

  return <section className="cms-document">
    <div className="cms-document-topbar">
      <button className="cms-back" onClick={onClose}><ArrowLeft size={17} /> Content library</button>
      <div className="cms-document-actions">
        <span className={`cms-save-state ${dirty ? "unsaved" : ""}`} role="status">{dirty ? "Unsaved changes" : saved ? <><Check size={14} /> Saved</> : `Version ${document.revision}`}</span>
        <button className="cms-button secondary" onClick={() => { setPreview(!preview); setTab("content"); }}>{preview ? <PencilLine size={15} /> : <Eye size={15} />}{preview ? "Edit" : "Preview"}</button>
        <button className="cms-button" onClick={save} disabled={!dirty || saving || !maySaveTitle}><Save size={15} />{saving ? "Saving…" : "Save changes"}</button>
      </div>
    </div>
    {error && <div className="cms-alert" role="alert"><AlertCircle size={18} /><div>{error}<p>Your unsaved text remains in the editor.</p></div></div>}
    <div className="cms-editor-grid">
      <div className="cms-writing-column">
        <div className="cms-document-heading">
          <div className="cms-eyebrow">{CONTENT_TYPE_LABELS[document.kind].singular} <span> / </span> {document.source_system === "print" ? String(document.metadata.issue_label || "Print intake") : document.source_system === "morweb" ? "Archive import" : "Original content"}</div>
          <label className="cms-sr-only" htmlFor="document-title">Headline</label>
          <textarea id="document-title" className="cms-headline" rows={2} value={draft.title} maxLength={500} onChange={e => update("title", e.target.value)} placeholder="Write a headline" />
          <div className="cms-byline"><label htmlFor="document-byline">By</label><input id="document-byline" placeholder="Add the editorial byline" value={draft.byline} onChange={e => update("byline", e.target.value)} /></div>
        </div>
        <div className="cms-editor-tabs" role="tablist" aria-label="Document sections">
          {([
            ["content", "Story", PencilLine], ["media", "Images", ImageIcon], ["sources", "Source updates", FileClock], ["history", "History", History],
          ] as const).map(([key, label, Icon]) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setPreview(false); setHistoryError(""); if (key === "media") setMediaResult({ identity: "", urls: {}, error: "" }); }}><Icon size={15} />{label}{key === "media" && media.length > 0 && <span>{media.length}</span>}</button>)}
        </div>
        <div className="cms-editor-panel">
          {tab === "content" && (preview ? <ArticlePreview title={draft.title} byline={draft.byline} html={draft.body_html} /> : <>
            <label className="cms-summary-label" htmlFor="document-summary">Summary / subheader</label>
            <textarea id="document-summary" className="cms-summary" rows={2} placeholder="Add a short introduction for readers…" value={draft.excerpt} onChange={e => update("excerpt", e.target.value)} />
            <RichEditor key={`${document.id}:${document.revision}:${contentEpoch}`} html={draft.body_html} onChange={value => update("body_html", value)} />
            <footer className="cms-editor-footer"><span>{wordCount.toLocaleString()} words</span><span>Original source retained in history</span></footer>
          </>)}
          {tab === "media" && <div className="cms-panel-pad">
            <h2>Images for this story</h2><p className="cms-muted">Review the images, choose a lead, and add captions, credits, and alternative text.</p>
            {mediaError && <p className="cms-alert" role="alert">{mediaError}</p>}
            {!media.length && <div className="cms-empty small"><ImageIcon size={28} /><h3>No images attached</h3><p>Extracted images appear here when a print issue is processed.</p></div>}
            {media.map((value, index) => { const item = object(value); return <div className="cms-media-review" key={String(item.sha256 || item.file || index)}>
              <div className="cms-image-thumb">{mediaUrls[mediaKey(item)] ? <img src={mediaUrls[mediaKey(item)]} alt={String(item.alt || "Extracted image preview")} /> : <ImageIcon size={26} />}</div>
              <div className="cms-media-fields"><strong>{String(item.file || `Image ${index + 1}`)}</strong>
                {(["caption", "credit", "alt"] as const).map(field => <label key={field}>{field === "alt" ? "Alternative text" : field}<input value={String(item[field] || "")} onChange={e => meta("media", media.map((entry, idx) => idx === index ? { ...item, [field]: e.target.value } : entry))} /></label>)}
                <label className="cms-checkbox"><input type="checkbox" checked={item.is_lead === true} onChange={e => meta("media", media.map((entry, idx) => ({ ...object(entry), is_lead: idx === index ? e.target.checked : false })))} />Use as lead image</label>
              </div>
            </div>; })}
          </div>}
          {(tab === "history" || tab === "sources") && <div className="cms-panel-pad">
            {historyError && <p className="cms-alert" role="alert">{historyError}</p>}
            {!history && !historyError && <div className="cms-loading">Loading document history…</div>}
            {tab === "sources" && <><h2>Source updates</h2><p className="cms-muted">A new extraction is kept here for comparison. Your edited story stays intact until you choose to use new text.</p>
              {history?.sources.map(source => <details key={source.id} className="cms-source-card" open={source.is_candidate}>
                <summary><span className={`cms-state ${source.is_candidate ? "review" : "draft"}`}>{source.is_candidate ? "Source update" : "Original source"}</span><strong>{source.title}</strong><span>{date(source.created_at)}</span><ChevronDown size={15} /></summary>
                <ArticlePreview title={source.title} byline={source.byline} html={source.body_html} />
                <div className="cms-source-actions"><p>Use the headline, byline, and body as an unsaved edit. Existing revisions remain available.</p><button className="cms-button secondary small" onClick={() => adopt(source)}>Use this text</button></div>
              </details>)}
              {!demo && document.source_system === "morweb" && <MigrationSources key={document.id} documentId={document.id} />}
            </>}
            {tab === "history" && <><h2>Revision history</h2><p className="cms-muted">Every save creates a version. Restoring text creates a new edit when you save it.</p>
              <div className="cms-history-list">{history?.revisions.map(version => <button key={version.id} onClick={() => setSelectedRevision(version)} className={selectedRevision?.id === version.id ? "selected" : ""}><span className="cms-history-icon"><History size={17} /></span><span><strong>Version {version.revision}{version.revision === document.revision && " · Current"}</strong><small>{version.reason === "ingest" ? "Imported source" : "Editorial save"}</small></span><time>{date(version.created_at)}</time></button>)}</div>
              {selectedRevision && <div className="cms-revision-preview"><ArticlePreview title={selectedRevision.snapshot.title} byline={selectedRevision.snapshot.byline} html={selectedRevision.snapshot.body_html} /><button className="cms-button secondary" onClick={() => restore(selectedRevision)}><RotateCcw size={15} />Restore this version as an edit</button></div>}
              {history && <p className="cms-fineprint">Showing the latest {history.revisions.length} revisions, up to 30.</p>}
            </>}
          </div>}
        </div>
      </div>
      <aside className="cms-properties">
        {needsReview && <section className="cms-property-card cms-import-review"><h3>Import review</h3><p>This record is retained. Resolve these findings before it can be published:</p><ul>{findings.length ? findings.map((finding, index) => <li key={index}>{finding}</li>) : <li>Editorial review is required.</li>}</ul><p className="cms-fineprint">Editing the story keeps these findings for review.</p></section>}
        <section className="cms-property-card"><h3>Editorial status</h3><label>Status<select value={draft.publication_state} onChange={e => update("publication_state", e.target.value)}><option value="draft">Draft</option><option value="review">Needs review</option><option value="unpublished">Unpublished</option>{document.publication_state === "published" && <option value="published">Published in source</option>}</select></label><p className="cms-fineprint">This workspace prepares content. Website publishing will be connected separately.</p><div className="cms-property-detail"><span>Last saved</span><strong>{date(document.updated_at)}</strong></div><div className="cms-property-detail"><span>Content source</span><strong>{document.source_system === "morweb" ? "Morweb archive" : document.source_system === "print" ? "Print issue" : "Editorial"}</strong></div></section>
        {document.kind === "rating" && <section className="cms-property-card"><h3>Rating</h3><div className="cms-rating-numbers"><label>Score<input type="number" min="0" max="100" value={typeof rating.score === "number" ? rating.score : ""} onChange={e => meta("rating", { ...rating, score: e.target.value === "" ? null : Number(e.target.value) })} /></label><label>Price<input type="number" min="0" step="0.01" value={typeof rating.price === "number" ? rating.price : ""} onChange={e => meta("rating", { ...rating, price: e.target.value === "" ? null : Number(e.target.value) })} /></label></div>{["brand", "category", "issue", "reviewer"].map(field => <label key={field}>{field}<input value={String(rating[field] || "")} onChange={e => meta("rating", { ...rating, [field]: e.target.value })} /></label>)}</section>}
        <section className="cms-property-card"><h3>Permanent home & topics</h3><div className="cms-channel-value"><span>Primary channel</span><strong>{organization.primary_channel || "Awaiting channel review"}</strong></div>{!organization.primary_channel && <p className="cms-fineprint">Existing content and URLs are retained while the new channel structure is reviewed.</p>}<label>Topics<input key={`topics:${document.revision}:${contentEpoch}`} defaultValue={organization.topics.join(", ")} placeholder="Separate topics with commas" onChange={e => meta("organization", { ...organization, topics: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} /></label></section>
        <section className="cms-property-card"><h3>Homepage placements</h3><p className="cms-fineprint">Promotion has its own schedule. Ending a placement keeps the story, permanent channel, and URL.</p>{organization.placements.map((placement, index) => <div className="cms-placement-card" key={placement.slot}><strong>{PLACEMENT_LABELS[placement.slot]}</strong><label>Placement status<select aria-label={`${PLACEMENT_LABELS[placement.slot]} status`} value={placement.status} onChange={e => updatePlacement(index, { status: e.target.value as CmsPlacement["status"] })}><option value="needs_review">Needs review</option><option value="scheduled">Scheduled</option><option value="disabled">Disabled</option></select></label>{placement.status === "needs_review" && placement.source_category_id && <p className="cms-fineprint">The source category was preserved. Its promotion dates were not supplied.</p>}<div className="cms-placement-dates">{(["starts_at", "ends_at"] as const).map(field => <label key={field}>{field === "starts_at" ? "Starts (UTC)" : "Ends (UTC)"}<input aria-label={`${PLACEMENT_LABELS[placement.slot]} ${field === "starts_at" ? "start" : "end"} UTC`} type="datetime-local" value={placement[field]?.slice(0, 16) || ""} onChange={e => updatePlacement(index, { [field]: e.target.value ? `${e.target.value}:00Z` : null })} /></label>)}</div></div>)}{!organization.placements.length && <p className="cms-fineprint">No homepage promotion assigned.</p>}{organization.placements.length < Object.keys(PLACEMENT_LABELS).length && <button type="button" className="cms-button secondary small" onClick={addPlacement}>Add homepage placement</button>}</section>
        <section className="cms-property-card"><h3>Source classification</h3><p className="cms-fineprint">Original categories and tags remain available for migration review.</p><div className="cms-source-taxonomy"><span>Categories</span><p>{organization.source_categories.join(", ") || "None supplied"}</p><span>Tags</span><p>{Array.isArray(draft.metadata.tags) ? draft.metadata.tags.filter(value => typeof value === "string").join(", ") || "None supplied" : "None supplied"}</p></div></section>
        <section className="cms-property-card"><h3>Search & sharing</h3><label>URL slug<input value={draft.slug || ""} onChange={e => update("slug", e.target.value || null)} placeholder="article-url" /></label><label>Search title<input value={String(seo.title || "")} maxLength={250} onChange={e => meta("seo", { ...seo, title: e.target.value })} /></label><label>Search description<textarea rows={3} value={String(seo.description || "")} onChange={e => meta("seo", { ...seo, description: e.target.value })} /></label><label className="cms-checkbox"><input type="checkbox" checked={seo.no_index === true} onChange={e => meta("seo", { ...seo, no_index: e.target.checked })} />Exclude from search engines</label>{sourcePublicUrl && /^https?:\/\//.test(sourcePublicUrl) && <a className="cms-source-link" href={sourcePublicUrl} target="_blank" rel="noreferrer">Original public page <ExternalLink size={13} /></a>}</section>
      </aside>
    </div>
  </section>;
}
