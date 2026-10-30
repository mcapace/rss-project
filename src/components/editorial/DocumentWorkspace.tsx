"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarClock, Check, Clock, Eye, FileText, History, ImageIcon, Info, Layers, PenLine, RotateCcw, Save, Search, Star, X } from "lucide-react";
import type { CmsDocument, CmsDocumentPatch, CmsDocumentRevision, CmsJsonObject, CmsPublicationState } from "@/lib/cms/types";
import { CONTENT_TYPE_LABELS, SOURCE_SYSTEM_LABELS, reviewReasons, reviewRequired } from "@/lib/cms/organization";
import { DataError, type MediaItem } from "@/lib/editorial/data";
import { diffSummary, formatDateTime, isoToLocalInput, localInputToIso, readingMinutes, relativeTime, scheduleOf, sectionOf, slugify, STATE_LABELS, stringList, stripHtml, textDiff, withSchedule, wordCount } from "@/lib/editorial/helpers";
import { rememberDocument } from "@/lib/editorial/scheduling";
import { useEditorial } from "./EditorialProvider";
import { useAsync } from "./hooks";
import { usePageTitle, useShell } from "./Shell";
import { BodyEditor } from "./BodyEditor";
import { Button, Card, Empty, Field, LinkButton, Notice, Pill, Segmented, Skeleton, SkeletonRows, Switch, Tag } from "./ui";

type Draft = Pick<CmsDocument, "title" | "byline" | "body_html" | "excerpt" | "slug" | "public_url" | "publication_state" | "metadata">;
type Tab = "write" | "preview" | "history" | "sources" | "media";
const DRAFT_FIELDS: (keyof Draft)[] = ["title", "byline", "body_html", "excerpt", "slug", "public_url", "publication_state", "metadata"];

const toDraft = (doc: CmsDocument): Draft => ({ title: doc.title, byline: doc.byline, body_html: doc.body_html, excerpt: doc.excerpt, slug: doc.slug, public_url: doc.public_url, publication_state: doc.publication_state, metadata: structuredClone(doc.metadata) });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const draftKey = (id: string) => `editorial-draft:${id}`;

function patchFor(document: CmsDocument, draft: Draft): CmsDocumentPatch {
  const patch: CmsDocumentPatch = {};
  for (const field of DRAFT_FIELDS) if (!same(draft[field], document[field])) (patch as Record<string, unknown>)[field] = draft[field];
  return patch;
}

function MediaThumb({ src, alt }: { src: string; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- Presigned S3 and data URLs cannot go through the image optimizer.
  return <img src={src} alt={alt} />;
}

function escapeHtml(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;"); }

function PreviewFrame({ title, byline, excerpt, section, html }: { title: string; byline: string; excerpt: string; section: string; html: string }) {
  const content = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'"><style>body{font:17px/1.7 Georgia,'Times New Roman',serif;color:#1b1b1b;background:#fff;margin:0;padding:48px 24px;overflow-wrap:anywhere}main{max-width:680px;margin:0 auto}.kicker{font:600 12px/1.4 system-ui,sans-serif;letter-spacing:.02em;color:#0e7c6f}h1{font:600 38px/1.1 system-ui,sans-serif;letter-spacing:-.02em;margin:8px 0 12px}.dek{font:17px/1.5 system-ui,sans-serif;color:#5e5e5e;margin:0 0 18px}.byline{font:13px/1.5 system-ui,sans-serif;color:#5e5e5e;padding:0 0 18px;margin:0 0 28px;border-bottom:1px solid #e5e5e5}h2{font:600 26px/1.25 system-ui,sans-serif;margin:36px 0 10px}h3{font:600 20px/1.3 system-ui,sans-serif;margin:28px 0 8px}a{color:#0e7c6f}img{max-width:100%;height:auto;border-radius:6px}blockquote{border-left:2px solid #d4d4d4;padding-left:20px;margin:28px 0;color:#5e5e5e}table{border-collapse:collapse;width:100%}td,th{border:1px solid #e5e5e5;padding:8px}hr{border:0;border-top:1px solid #e5e5e5;margin:32px 0}</style></head><body><main>${section ? `<p class="kicker">${escapeHtml(section)}</p>` : ""}<h1>${escapeHtml(title || "Untitled")}</h1>${excerpt ? `<p class="dek">${escapeHtml(excerpt)}</p>` : ""}<p class="byline">${byline ? `By ${escapeHtml(byline)} · ` : ""}Preview</p>${html}</main></body></html>`;
  return <iframe title="Article preview" sandbox="" referrerPolicy="no-referrer" srcDoc={content} style={{ width: "100%", minHeight: "70vh", border: "1px solid var(--border)", borderRadius: 12, background: "#fff" }} />;
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

export function DocumentWorkspace({ id }: { id: string }) {
  const { data, href, toast, demo, brand } = useEditorial();
  const { setDirty: setShellDirty } = useShell();
  const loaded = useAsync(`doc:${id}`, signal => data.getDocument(id, signal));
  const [document, setDocument] = useState<CmsDocument | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tab, setTab] = useState<Tab>("write");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; conflict?: boolean } | null>(null);
  const [recovered, setRecovered] = useState<Draft | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [compare, setCompare] = useState<CmsDocumentRevision | null>(null);
  const [historyToken, setHistoryToken] = useState(0);
  const saveRef = useRef<() => void>(() => {});

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
        else window.localStorage.removeItem(draftKey(document.id));
      } catch { /* storage unavailable */ }
    }, 600);
    return () => clearTimeout(timer);
  }, [draft, document, dirty]);
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
  }, [document, draft, saving, data, toast]);
  useEffect(() => { saveRef.current = save; }, [save]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); saveRef.current(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const history = useAsync(`history:${id}:${document?.revision ?? 0}:${historyToken}`, signal => data.history(id, signal), { enabled: !!document && (tab === "history" || tab === "sources") });
  const media = useAsync(`media:${id}`, signal => data.media(id, signal), { enabled: !!document && tab === "media" });
  const mediaMeta = useMemo(() => (Array.isArray(draft?.metadata.media) ? draft.metadata.media : []) as CmsJsonObject[], [draft]);

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

  return <div className="ed-editor">
    <div className="ed-editor-main">
      <div className="ed-editor-bar">
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <LinkButton href={href("/cms/library")} size="sm" variant="subtle" icon={ArrowLeft}>Library</LinkButton>
          <Pill tone={document.publication_state !== "published" && schedule ? "scheduled" : document.publication_state} />
          <Tag>{CONTENT_TYPE_LABELS[document.kind].singular}</Tag>
          <Tag>{SOURCE_SYSTEM_LABELS[document.source_system].short}</Tag>
        </div>
        <div className="ed-editor-status">
          <span className="ed-wordcount"><PenLine size={13} aria-hidden />{words.toLocaleString()} words · {readingMinutes(words)} min read</span>
          <span>{saving ? "Saving…" : dirty ? "Unsaved changes" : lastSaved ? `Saved ${relativeTime(lastSaved)}` : `Revision ${document.revision}`}</span>
          <Button variant="primary" size="sm" icon={Save} disabled={!dirty || saving} onClick={save} title="Save (⌘S)">{saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>

      {recovered && <div style={{ marginBottom: 12 }}><Notice icon={RotateCcw}><span>You have unsaved edits from an earlier visit to this document.</span> <button type="button" className="ed-link" onClick={() => { setDraft(recovered); setRecovered(null); }}>Restore them</button> · <button type="button" className="ed-link" onClick={() => { setRecovered(null); try { window.localStorage.removeItem(draftKey(document.id)); } catch { /* ignore */ } }}>Discard</button></Notice></div>}
      {error && <div style={{ marginBottom: 12 }}><Notice tone="error" icon={X}>{error.message}{error.conflict && <> <button type="button" className="ed-link" onClick={() => setTab("history")}>Open History</button></>}</Notice></div>}
      {gate && <div style={{ marginBottom: 12 }}><Notice tone="warning">Editorial review required before this can publish{reasons.length ? `: ${reasons.join(", ")}` : "."}</Notice></div>}
      {warnings.length > 0 && !gate && <div style={{ marginBottom: 12 }}><Notice>{warnings[0]}</Notice></div>}

      <Segmented label="Editor view" value={tab} onChange={setTab} options={tabs} />

      {tab === "write" && <div style={{ marginTop: 20 }}>
        <textarea className="ed-title-input" rows={1} value={draft.title} placeholder="Headline" aria-label="Title" maxLength={500}
          ref={node => { if (node) { node.style.height = "auto"; node.style.height = `${node.scrollHeight}px`; } }}
          onChange={event => { update({ title: event.target.value }); event.target.style.height = "auto"; event.target.style.height = `${event.target.scrollHeight}px`; }} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} />
        <input className="ed-byline-input" style={{ marginTop: 8 }} value={draft.byline} placeholder="Byline" aria-label="Byline" maxLength={1000} onChange={event => update({ byline: event.target.value })} />
        <BodyEditor key={`${document.id}:${document.revision}`} html={draft.body_html} onChange={body_html => update({ body_html })} />
      </div>}

      {tab === "preview" && <div style={{ marginTop: 16 }}><PreviewFrame title={draft.title} byline={draft.byline} excerpt={draft.excerpt} section={sectionOf(draft.metadata)} html={draft.body_html} /></div>}

      {tab === "history" && <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
        {history.loading && !history.data ? <SkeletonRows rows={4} /> : history.error ? <Notice tone="error">{history.error}</Notice> : <>
          {compare ? <Card>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
              <strong style={{ fontSize: 14 }}>Revision {compare.revision} <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {compare.actor} · {formatDateTime(compare.created_at)}</span></strong>
              <div style={{ display: "flex", gap: 8 }}>
                <Button size="sm" icon={RotateCcw} onClick={() => { const snapshot = compare.snapshot; setDraft(current => current ? { ...current, title: snapshot.title, byline: snapshot.byline, body_html: snapshot.body_html, excerpt: snapshot.excerpt, slug: snapshot.slug, public_url: snapshot.public_url, metadata: { ...snapshot.metadata, review: current.metadata.review ?? snapshot.metadata.review } } : current); setTab("write"); toast(`Revision ${compare.revision} restored to your draft. Save to keep it.`); }}>Restore to draft</Button>
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
              <Button size="sm" icon={Check} onClick={() => { update({ title: source.title, byline: source.byline, body_html: source.body_html }); setTab("write"); toast("Source text copied into your draft. Save to keep it."); }}>Adopt into draft</Button>
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
            return <Card key={index} pad="sm">
              <div style={{ display: "grid", gridTemplateColumns: "96px 1fr", gap: 14, alignItems: "start" }}>
                <div className="ed-media-tile" data-lead={item.is_lead === true}>{preview?.preview_url ? <MediaThumb src={preview.preview_url} alt={typeof item.alt === "string" ? item.alt : ""} /> : <span style={{ position: "static", display: "grid", placeItems: "center", height: "100%", background: "transparent", color: "var(--muted)" }}><ImageIcon size={20} aria-hidden /></span>}{item.is_lead === true && <span>Lead</span>}</div>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}><span style={{ fontSize: 12.5, color: "var(--muted)" }}>{typeof item.file === "string" ? item.file : `Image ${index + 1}`}</span><label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>Lead image <Switch checked={item.is_lead === true} onChange={next => set({ is_lead: next })} label={`Use image ${index + 1} as the lead`} /></label></div>
                  <input className="ed-input" placeholder="Caption" aria-label="Caption" value={typeof item.caption === "string" ? item.caption : ""} onChange={event => set({ caption: event.target.value })} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <input className="ed-input" placeholder="Credit" aria-label="Credit" value={typeof item.credit === "string" ? item.credit : ""} onChange={event => set({ credit: event.target.value })} />
                    <input className="ed-input" placeholder="Alt text" aria-label="Alt text" value={typeof item.alt === "string" ? item.alt : ""} onChange={event => set({ alt: event.target.value })} />
                  </div>
                </div>
              </div>
            </Card>;
          })}
        </div>}
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
        {document.published_at && <p style={{ marginTop: 12, fontSize: 12.5, color: "var(--muted)" }}><CalendarClock size={12} aria-hidden style={{ verticalAlign: -1, marginRight: 4 }} />Published {formatDateTime(document.published_at)}</p>}
      </Card>

      <Card pad={false} className="ed-rail-card still">
        <h3>Properties <Info size={14} aria-hidden /></h3>
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
      </Card>

      {document.kind === "rating" || document.kind === "product_review" ? <Card pad={false} className="ed-rail-card still">
        <h3>Rating <Star size={14} aria-hidden /></h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Score" htmlFor="ed-score"><input id="ed-score" className="ed-input" type="number" min={0} max={100} value={typeof rating.score === "number" ? rating.score : ""} onChange={event => updateMeta({ rating: { ...rating, score: event.target.value === "" ? null : Number(event.target.value) } })} /></Field>
          <Field label="Price" htmlFor="ed-price"><input id="ed-price" className="ed-input" type="number" min={0} step="0.01" value={typeof rating.price === "number" ? rating.price : ""} onChange={event => updateMeta({ rating: { ...rating, price: event.target.value === "" ? null : Number(event.target.value) } })} /></Field>
        </div>
        <Field label="Producer or brand" htmlFor="ed-rating-brand"><input id="ed-rating-brand" className="ed-input" value={typeof rating.brand === "string" ? rating.brand : ""} onChange={event => updateMeta({ rating: { ...rating, brand: event.target.value } })} /></Field>
        <Field label="Category" htmlFor="ed-rating-category"><input id="ed-rating-category" className="ed-input" value={typeof rating.category === "string" ? rating.category : ""} onChange={event => updateMeta({ rating: { ...rating, category: event.target.value } })} /></Field>
        <Field label="Reviewer" htmlFor="ed-rating-reviewer"><input id="ed-rating-reviewer" className="ed-input" value={typeof rating.reviewer === "string" ? rating.reviewer : ""} onChange={event => updateMeta({ rating: { ...rating, reviewer: event.target.value } })} /></Field>
      </Card> : null}

      <Card pad={false} className="ed-rail-card still">
        <h3>Search <Search size={14} aria-hidden /></h3>
        <Field label="Search title" htmlFor="ed-seo-title" hint={`${String(seo.title ?? "").length}/60`}><input id="ed-seo-title" className="ed-input" maxLength={120} value={typeof seo.title === "string" ? seo.title : ""} onChange={event => updateMeta({ seo: { ...seo, title: event.target.value } })} placeholder={draft.title} /></Field>
        <Field label="Search description" htmlFor="ed-seo-description" hint={`${String(seo.description ?? "").length}/160`}><textarea id="ed-seo-description" className="ed-textarea" rows={3} maxLength={320} value={typeof seo.description === "string" ? seo.description : ""} onChange={event => updateMeta({ seo: { ...seo, description: event.target.value } })} placeholder={draft.excerpt} /></Field>
        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12, fontSize: 13 }}>Hide from search engines <Switch checked={seo.no_index === true} onChange={next => updateMeta({ seo: { ...seo, no_index: next } })} label="Hide from search engines" /></label>
      </Card>

      <Card pad={false} className="ed-rail-card still">
        <h3>Details <History size={14} aria-hidden /></h3>
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
      </Card>
    </aside>
  </div>;
}
