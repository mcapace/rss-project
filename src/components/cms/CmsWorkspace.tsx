"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Layers3, FileText, Star, PanelsTopLeft, ClipboardCheck, BookOpen, ArrowUpRight, Search, Plus, ChevronDown, ChevronLeft, ChevronRight, ArrowRight, AlertCircle, X, Menu, LogOut, RefreshCw, PenLine, FileInput } from "lucide-react";
import { BRANDS } from "@/lib/brands";
import { isCmsBrand, publicationHref, resolveCmsBrand } from "@/lib/cms/publications";
import { CMS_BRANDS } from "@/lib/cms/types";
import type { CmsUser } from "@/lib/cms/access";
import type { CmsBrand, CmsDocument, CmsDocumentKind, CmsDocumentPatch, CmsDocumentRevision } from "@/lib/cms/types";
import { demoDocuments, demoRevision, demoSources } from "@/lib/cms/demo";
import { DocumentEditor, type HistoryData } from "./DocumentEditor";
import "./cms.css";

type Row = Pick<CmsDocument, "id" | "brand" | "kind" | "source_system" | "title" | "byline" | "excerpt" | "publication_state" | "published_at" | "issue_uuid" | "revision" | "created_at" | "updated_at">;
const sampleUser: CmsUser = { id: "demo", email: "Demo editor", role: "admin", brands: [...CMS_BRANDS] };
const demoKey = "mshanken-cms-demo-v1";
const initialSamples = demoDocuments();
const stateLabels: Record<string, string> = { draft: "Draft", review: "Needs review", published: "Published", unpublished: "Unpublished" };

async function requestJson(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "The request could not be completed.");
  return body;
}

export function CmsWorkspace({ demo = false, user = sampleUser, initialBrand, initialIssue }: { demo?: boolean; user?: CmsUser; initialBrand?: string; initialIssue?: string }) {
  const router = useRouter();
  const [brand, setBrand] = useState<CmsBrand>(() => resolveCmsBrand(initialBrand, user.brands) || user.brands[0]);
  const [kind, setKind] = useState<"" | CmsDocumentKind>("");
  const [state, setState] = useState("");
  const [issue, setIssue] = useState(initialIssue || "");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [overview, setOverview] = useState<{ total: number; review: number; drafts: number; ratings: number } | null>(null);
  const [loadedQuery, setLoadedQuery] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<CmsDocument | null>(null);
  const [opening, setOpening] = useState("");
  const [dirty, setDirty] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createKind, setCreateKind] = useState<CmsDocumentKind>("article");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [demoRows, setDemoRows] = useState(initialSamples);
  const [demoHistories, setDemoHistories] = useState<Record<string, CmsDocumentRevision[]>>(() => Object.fromEntries(initialSamples.map(row => [row.id, [demoRevision(row)]])));
  const [demoLoaded, setDemoLoaded] = useState(false);
  const openController = useRef<AbortController | null>(null);
  const selectionEpoch = useRef(0);
  const pendingSaves = useRef(new Set<number>());
  const onDirtyChange = useCallback((value: boolean) => setDirty(value), []);
  const queryIdentity = JSON.stringify([brand, kind, state, debouncedSearch, page, issue, reload]);
  const loading = !demo && loadedQuery !== queryIdentity;
  useEffect(() => () => { openController.current?.abort(); selectionEpoch.current += 1; }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("brand", brand);
    if (issue) url.searchParams.set("issue", issue);
    else url.searchParams.delete("issue");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [brand, issue]);

  useEffect(() => { if (search === debouncedSearch) return; const timer = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 250); return () => clearTimeout(timer); }, [search, debouncedSearch]);
  useEffect(() => {
    if (!demo) return;
    try {
      const saved = JSON.parse(localStorage.getItem(demoKey) || "null");
      if (saved && Array.isArray(saved.documents) && saved.histories && saved.documents.every((item: CmsDocument) => item.id && item.title && item.metadata && isCmsBrand(item.brand))) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate browser-only demo storage after SSR so the first client render matches the server.
        setDemoRows(saved.documents); setDemoHistories(saved.histories);
      }
    } catch { /* An old demo state can safely fall back to the synthetic examples. */ }
    setDemoLoaded(true);
  }, [demo]);
  useEffect(() => {
    if (!demo || !demoLoaded) return;
    try { localStorage.setItem(demoKey, JSON.stringify({ documents: demoRows, histories: demoHistories })); }
    catch {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Report a failure from the external browser storage write; this does not derive state from props.
      setError("This browser could not retain the demo changes. They remain available until this page closes.");
    }
  }, [demo, demoLoaded, demoRows, demoHistories]);

  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ brand, page: String(page) });
    if (kind) query.set("kind", kind);
    if (state) query.set("state", state);
    if (debouncedSearch) query.set("q", debouncedSearch);
    if (issue) query.set("issue", issue);
    requestJson(`/api/cms/documents?${query}`, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) { setRows(data.documents); setTotal(data.total); setError(""); } }).catch(err => { if (!controller.signal.aborted) setError(err.message); }).finally(() => { if (!controller.signal.aborted) setLoadedQuery(queryIdentity); });
    return () => controller.abort();
  }, [demo, brand, kind, state, debouncedSearch, page, issue, reload, queryIdentity]);
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    requestJson(`/api/cms/overview?brand=${brand}`, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setOverview(data); }).catch(() => { if (!controller.signal.aborted) setOverview(null); });
    return () => controller.abort();
  }, [demo, brand, reload]);

  const matchingDemo = useMemo(() => demoRows.filter(row => row.brand === brand && (!kind || row.kind === kind) && (!state || row.publication_state === state) && (!issue || row.issue_uuid === issue) && row.title.toLowerCase().includes(debouncedSearch.toLowerCase())).sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [demoRows, brand, kind, state, issue, debouncedSearch]);
  const displayRows = demo ? matchingDemo.slice((page - 1) * 50, page * 50) : rows;
  const displayTotal = demo ? matchingDemo.length : total;
  const publicationDemoRows = demoRows.filter(row => row.brand === brand);
  const stats = demo ? { total: publicationDemoRows.length, review: publicationDemoRows.filter(r => r.publication_state === "review").length, drafts: publicationDemoRows.filter(r => r.publication_state === "draft").length, ratings: publicationDemoRows.filter(r => r.kind === "rating").length } : overview;
  const pages = Math.max(1, Math.ceil(displayTotal / 50));
  const selectedBrand = BRANDS[brand];

  function canLeaveEditor() {
    if (pendingSaves.current.has(selectionEpoch.current)) return window.confirm("A save is still in progress and may finish after you leave. Leave this editor?");
    return !dirty || window.confirm("Leave this story without saving your changes?");
  }
  function cancelOpening() { openController.current?.abort(); setOpening(""); }
  function changeSearch(value: string) { cancelOpening(); setSearch(value); }
  function filterKind(value: "" | CmsDocumentKind) { cancelOpening(); setKind(value); setPage(1); }
  function filterState(value: string) { cancelOpening(); setState(value); setPage(1); }
  function changePublication(value: string) {
    const nextBrand = resolveCmsBrand(value, user.brands);
    if (!nextBrand || nextBrand === brand || !leaveEditor()) return;
    setBrand(nextBrand); setIssue(""); setPage(1); setOverview(null);
    setRows([]); setTotal(0); setError(""); setSearch(""); setDebouncedSearch("");
    setCreateOpen(false); setCreateTitle(""); setCreateError("");
  }
  function leaveEditor() {
    if (!canLeaveEditor()) return false;
    openController.current?.abort(); selectionEpoch.current += 1;
    setOpening(""); setSelected(null); setDirty(false); return true;
  }
  function navigate(nextKind: "" | CmsDocumentKind, nextState = "") {
    if (!leaveEditor()) return;
    setKind(nextKind); setState(nextState); setIssue(""); setPage(1); setSidebarOpen(false);
  }
  async function openDocument(row: Row) {
    openController.current?.abort();
    selectionEpoch.current += 1;
    const controller = new AbortController(); openController.current = controller;
    setOpening(row.id); setError("");
    try {
      const document = demo ? demoRows.find(item => item.id === row.id) : (await requestJson(`/api/cms/documents/${row.id}`, { signal: controller.signal })).document;
      if (document && !controller.signal.aborted) { setSelected(document); setDirty(false); }
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "This document could not be opened."); }
    finally { if (!controller.signal.aborted) setOpening(""); }
  }
  async function saveDocument(patch: CmsDocumentPatch) {
    if (!selected) throw new Error("Open a document first.");
    const epoch = selectionEpoch.current;
    if (pendingSaves.current.has(epoch)) throw new Error("A save is already in progress.");
    pendingSaves.current.add(epoch);
    try {
      let document: CmsDocument;
      if (demo) {
        if (patch.publication_state === "published" && selected.publication_state !== "published") throw new Error("Website publishing is not connected in this preview.");
        document = { ...selected, ...patch, revision: selected.revision + 1, updated_at: new Date().toISOString() };
        setDemoRows(previous => previous.map(row => row.id === document.id ? document : row));
        setDemoHistories(previous => ({ ...previous, [document.id]: [demoRevision(document), ...(previous[document.id] || [])] }));
      } else document = (await requestJson(`/api/cms/documents/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expected_revision: selected.revision, patch }) })).document;
      if (selectionEpoch.current === epoch) setSelected(current => current?.id === document.id && current.revision === selected.revision ? document : current);
      setReload(value => value + 1); return document;
    } finally { pendingSaves.current.delete(epoch); }
  }
  const loadHistory = useCallback(async (): Promise<HistoryData> => {
    if (!selected) return { revisions: [], sources: [] };
    if (!demo) return requestJson(`/api/cms/documents/${selected.id}/history`);
    const original = initialSamples.find(row => row.id === selected.id) || demoHistories[selected.id]?.at(-1)?.snapshot || selected;
    const sources = demoSources(original).map(source => ({ id: source.id, source_hash: source.source_hash, created_at: source.created_at, is_candidate: false, title: source.payload.title, byline: source.payload.byline || "", body_html: source.payload.body_html, metadata: source.payload.metadata || {} }));
    if (selected.source_system === "print") sources.unshift({ ...sources[0], id: `${selected.id}:candidate`, source_hash: "c".repeat(64), created_at: "2026-10-30T15:00:00Z", is_candidate: true, title: `${original.title} — revised extraction`, body_html: `${original.body_html}<p>This sample paragraph represents text found during a second extraction. The edited story has not been changed.</p>` });
    return { revisions: demoHistories[selected.id] || [], sources };
  }, [demo, selected, demoHistories]);

  async function createDocument(event: React.FormEvent) {
    event.preventDefault(); setCreating(true); setCreateError("");
    openController.current?.abort(); setOpening(""); selectionEpoch.current += 1;
    try {
      if (demo) {
        const now = new Date().toISOString();
        const document: CmsDocument = { ...initialSamples[0], id: crypto.randomUUID(), brand, title: createTitle.trim(), kind: createKind, body_html: "<p></p>", byline: "", excerpt: "", slug: null, public_url: null, published_at: null, identity_anchor: {}, source_system: "manual", source_key: crypto.randomUUID(), source_hash: "0".repeat(64), publication_state: "draft", issue_uuid: null, metadata: {}, revision: 1, created_at: now, updated_at: now };
        setDemoRows(previous => [document, ...previous]); setDemoHistories(previous => ({ ...previous, [document.id]: [demoRevision(document)] })); setSelected(document);
      } else {
        const result = await requestJson("/api/cms/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: createTitle, kind: createKind, brand }) });
        const data = await requestJson(`/api/cms/documents/${result.document_id}`); setSelected(data.document); setReload(value => value + 1);
      }
      setCreateOpen(false); setCreateTitle("");
    } catch (err) { setCreateError(err instanceof Error ? err.message : "The document could not be created."); }
    finally { setCreating(false); }
  }

  async function logout() {
    if (!leaveEditor()) return;
    try { await requestJson("/api/logout", { method: "POST" }); router.push("/login"); router.refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Sign out failed."); }
  }

  return <div className={`cms-shell ${sidebarOpen ? "sidebar-open" : ""}`}>
    {sidebarOpen && <button className="cms-sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
    <aside className="cms-sidebar">
      <Link href={publicationHref(demo ? "/cms/demo" : "/cms", brand)} className="cms-wordmark" onNavigate={event => { if (!canLeaveEditor()) event.preventDefault(); }}><span className="cms-monogram">M</span><span>SHANKEN<small>EDITORIAL WORKSPACE</small></span></Link>
      <div className="cms-publication"><span className="cms-publication-icon">{selectedBrand.short}</span><div><label htmlFor="cms-brand">Publication</label><select id="cms-brand" value={brand} onChange={e => changePublication(e.target.value)}>{user.brands.map(key => <option key={key} value={key}>{BRANDS[key].name}</option>)}</select></div><ChevronDown size={14} /></div>
      <div className="cms-nav-label">Workspace</div>
      <nav className="cms-navigation" aria-label="CMS navigation">
        {([
          ["", "Content library", Layers3], ["article", "Articles", FileText], ["rating", "Ratings", Star], ["page", "Pages", PanelsTopLeft],
        ] as const).map(([key, label, Icon]) => <button key={label} className={kind === key && !state && !issue ? "active" : ""} onClick={() => navigate(key)}><Icon size={18} /><span>{label}</span>{key === "" && stats && <em>{stats.total.toLocaleString()}</em>}</button>)}
        <button className={state === "review" ? "active" : ""} onClick={() => navigate("", "review")}><ClipboardCheck size={18} /><span>Review queue</span>{!!stats?.review && <em className="gold">{stats.review}</em>}</button>
      </nav>
      <div className="cms-nav-label">Print to web</div>
      <nav className="cms-navigation" aria-label="Print workflow"><Link href={publicationHref("/admin", brand)} onNavigate={event => { if (!canLeaveEditor()) event.preventDefault(); }}><BookOpen size={18} /><span>Issue inbox</span><ArrowUpRight size={14} /></Link><Link href={publicationHref("/admin/new", brand)} onNavigate={event => { if (!canLeaveEditor()) event.preventDefault(); }}><FileInput size={18} /><span>Upload an issue</span></Link></nav>
      <div className="cms-sidebar-bottom"><div className="cms-environment"><span />{demo ? "Interactive demo" : "Connected workspace"}</div><div className="cms-user"><span className="cms-avatar">{demo ? "DE" : user.email.slice(0, 2).toUpperCase()}</span><div><strong>{demo ? "Demo editor" : user.email}</strong><small>{demo ? "Sample content only" : `${user.role} access`}</small></div>{!demo && <button title="Sign out" aria-label="Sign out" onClick={logout}><LogOut size={17} /></button>}</div></div>
    </aside>
    <main className="cms-main">
      <header className="cms-workspace-top"><div className="cms-breadcrumb"><button className="cms-mobile-menu" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button><span>{selectedBrand.name}</span><span>/</span><strong>{selected ? "Editor" : "Content"}</strong></div><div className="cms-workspace-tag"><span />Editorial workspace</div></header>
      {demo && <div className="cms-demo-banner"><span><strong>Interactive demo</strong> · Sample content. Your edits are saved only in this browser.</span><Link href={publicationHref("/cms", brand)} onNavigate={event => { if (!canLeaveEditor()) event.preventDefault(); }}>Open connected workspace <ArrowUpRight size={13} /></Link></div>}
      {selected ? <DocumentEditor key={selected.id} document={selected} demo={demo} onClose={leaveEditor} onSave={saveDocument} onDirtyChange={onDirtyChange} loadHistory={loadHistory} /> : <div className="cms-content-page">
        <div className="cms-page-heading"><div><div className="cms-eyebrow">{issue ? "Print issue" : "Your publication, in one place"}</div><h1>{issue ? "Issue drafts" : state === "review" ? "Review queue" : kind === "rating" ? "Ratings" : kind === "article" ? "Articles" : kind === "page" ? "Pages" : "Content library"}</h1><p>{issue ? "Review the stories extracted from this issue." : "Write, refine, and organize the stories that make your publication."}</p></div><button className="cms-button" onClick={() => { cancelOpening(); setCreateOpen(true); setCreateKind(kind || "article"); setCreateError(""); }}><Plus size={17} />New content</button></div>
        <div className="cms-metrics">
          {([
            ["Content library", stats?.total, Layers3, "All content", "", ""],
            ["Needs review", stats?.review, ClipboardCheck, "Open queue", "", "review"],
            ["In progress", stats?.drafts, PenLine, "View drafts", "", "draft"],
            ["Ratings", stats?.ratings, Star, "Browse ratings", "rating", ""],
          ] as const).map(([label, value, Icon, action, nextKind, nextState]) => <button key={label} className="cms-metric" onClick={() => navigate(nextKind, nextState)}><div><span>{label}</span><Icon size={17} /></div><strong>{value === undefined || value === null ? "—" : value.toLocaleString()}</strong><small>{demo ? "Sample records" : action}<ArrowUpRight size={13} /></small></button>)}
        </div>
        <section className="cms-library">
          <div className="cms-library-tools"><div className="cms-library-tabs" aria-label="Filter by editorial status">{[["", "All content"], ["review", "Needs review"], ["draft", "Drafts"], ["published", "Published"], ["unpublished", "Unpublished"]].map(([value, label]) => <button key={value} aria-pressed={state === value} className={state === value ? "active" : ""} onClick={() => filterState(value)}>{label}</button>)}</div><button className="cms-icon-button" title="Refresh content" aria-label="Refresh content" onClick={() => setReload(value => value + 1)}><RefreshCw size={16} /></button></div>
          <div className="cms-filter-bar"><div className="cms-search"><Search size={17} /><input aria-label="Search content" value={search} onChange={e => changeSearch(e.target.value)} placeholder="Search by headline…" />{search && <button aria-label="Clear search" onClick={() => changeSearch("")}><X size={14} /></button>}</div><select aria-label="Content type" value={kind} onChange={e => filterKind(e.target.value as typeof kind)}><option value="">All types</option><option value="article">Articles</option><option value="rating">Ratings</option><option value="page">Pages</option></select>{issue && <button className="cms-filter-chip" onClick={() => { cancelOpening(); setIssue(""); setPage(1); }}>This issue <X size={12} /></button>}</div>
          {error && !loading && <div className="cms-alert" role="alert"><AlertCircle size={18} /><span>{error}</span><button className="cms-button secondary small" onClick={() => setReload(value => value + 1)}>Try again</button></div>}
          {loading ? <div className="cms-loading">Loading your content…</div> : displayRows.length ? <div className="cms-table-scroll"><table className="cms-content-table"><thead><tr><th>Content</th><th>Type</th><th>Byline</th><th>Status</th><th>Updated</th><th><span className="cms-sr-only">Open</span></th></tr></thead><tbody>{displayRows.map(row => <tr key={row.id}><td><button className="cms-story-link" onClick={() => openDocument(row)} disabled={!!opening}><span className={`cms-content-icon ${row.kind}`}>{row.kind === "rating" ? <Star size={18} /> : row.kind === "page" ? <PanelsTopLeft size={18} /> : <FileText size={18} />}</span><span><strong>{opening === row.id ? "Opening…" : row.title}</strong><small>{row.source_system === "print" ? "Print intake" : row.source_system === "morweb" ? "Archive import" : "Original content"}{row.excerpt && <> <span>·</span> {row.excerpt}</>}</small></span></button></td><td className="cms-type">{row.kind}</td><td>{row.byline || <span className="cms-muted">No byline</span>}</td><td><span className={`cms-state ${row.publication_state}`}><i />{stateLabels[row.publication_state]}</span></td><td><time dateTime={row.updated_at}>{new Date(row.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time></td><td><button className="cms-icon-button" aria-label={`Edit ${row.title}`} onClick={() => openDocument(row)} disabled={!!opening}><ArrowRight size={17} /></button></td></tr>)}</tbody></table></div> : !error && <div className="cms-empty"><Layers3 size={34} /><h2>{search || kind || state || issue ? "No matching content" : "Your editorial workspace is ready"}</h2><p>{search || kind || state || issue ? "Adjust the filters or search for another headline." : "Create a story or upload a print issue to begin. Archive imports appear here after they have been loaded for this publication."}</p><button className="cms-button secondary" onClick={() => { cancelOpening(); setSearch(""); setKind(""); setState(""); setIssue(""); setPage(1); if (!demo && !total) setCreateOpen(true); }}>{search || kind || state || issue ? "Clear filters" : "Create content"}</button></div>}
          <footer className="cms-table-footer"><span>{displayTotal.toLocaleString()} {demo ? "sample " : ""}{displayTotal === 1 ? "record" : "records"}{displayTotal > 50 && ` · page ${page} of ${pages}`}</span><div><button className="cms-icon-button" aria-label="Previous page" disabled={page <= 1} onClick={() => { cancelOpening(); setPage(page - 1); }}><ChevronLeft size={17} /></button><span>{page}</span><button className="cms-icon-button" aria-label="Next page" disabled={page >= pages} onClick={() => { cancelOpening(); setPage(page + 1); }}><ChevronRight size={17} /></button></div></footer>
        </section>
        <div className="cms-intake-note"><span className="cms-note-icon"><BookOpen size={22} /></span><div><h3>A direct path from print to web</h3><p>Upload an issue. Review its stories and images. Refine the web edition in your own workspace.</p></div><Link href={publicationHref("/admin/new", brand)}>Open print intake <ArrowUpRight size={15} /></Link></div>
      </div>}
    </main>
    {createOpen && <div className="cms-modal-backdrop" onClick={() => { if (!creating) setCreateOpen(false); }}><section className="cms-modal" role="dialog" aria-modal="true" aria-labelledby="new-content-title" onClick={e => e.stopPropagation()}><div className="cms-modal-heading"><span className="cms-eyebrow">{selectedBrand.name}</span><button className="cms-icon-button" aria-label="Close new content" onClick={() => setCreateOpen(false)} disabled={creating}><X size={18} /></button></div><h2 id="new-content-title">Start something new.</h2><p>Your document will begin as a private draft.</p><form onSubmit={createDocument}><label>Content type<select value={createKind} onChange={e => setCreateKind(e.target.value as CmsDocumentKind)}><option value="article">Article</option><option value="rating">Rating</option><option value="page">Page</option></select></label><label>Headline<input required autoFocus maxLength={500} value={createTitle} onChange={e => setCreateTitle(e.target.value)} placeholder="Give your draft a working title" /></label>{createError && <div className="cms-alert" role="alert">{createError}</div>}<button type="submit" className="cms-button" disabled={creating || !createTitle.trim()}>{creating ? "Creating…" : "Create draft"}<ArrowRight size={16} /></button></form></section></div>}
  </div>;
}
