"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Bookmark, ChevronLeft, ChevronRight, Download, LibraryBig, Plus, Rows3, Search, Trash2, X } from "lucide-react";
import type { CmsDocumentKind, CmsPublicationState } from "@/lib/cms/types";
import { CMS_DOCUMENT_KINDS } from "@/lib/cms/types";
import { CONTENT_TYPE_LABELS, SOURCE_SYSTEM_LABELS } from "@/lib/cms/organization";
import { addSavedView, formatDate, parseSavedViews, relativeTime, SAVED_VIEWS_KEY, sortBy, STATE_LABELS, type LibraryFilters, type SavedView } from "@/lib/editorial/helpers";
import type { DocumentRow } from "@/lib/editorial/data";
import { useEditorial } from "./EditorialProvider";
import { useAsync, useDebounced, useDismiss, useStoredState } from "./hooks";
import { Button, Card, Empty, IconButton, PageHeader, Pill, Segmented, SkeletonRows } from "./ui";
import { useShell } from "./Shell";

export type LibraryInitial = Partial<LibraryFilters> & { page?: number; issue?: string | null };

const STATES: { id: "" | CmsPublicationState; label: string }[] = [
  { id: "", label: "All" }, { id: "draft", label: "Drafts" }, { id: "review", label: "Needs review" }, { id: "published", label: "Published" }, { id: "unpublished", label: "Unpublished" },
];
const COLUMNS: { key: keyof DocumentRow; label: string; sortable?: boolean; className?: string }[] = [
  { key: "title", label: "Title", sortable: true },
  { key: "kind", label: "Type", sortable: true },
  { key: "publication_state", label: "Status", sortable: true },
  { key: "byline", label: "Byline", sortable: true },
  { key: "source_system", label: "Source" },
  { key: "updated_at", label: "Updated", sortable: true, className: "num" },
  { key: "published_at", label: "Published", sortable: true, className: "num" },
];

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, "\"\"")}"` : safe;
}

export function Library({ initial }: { initial: LibraryInitial }) {
  const router = useRouter();
  const { brand, data, href, toast, mutationVersion, refresh } = useEditorial();
  const { openCreate } = useShell();
  const [kind, setKind] = useState<"" | CmsDocumentKind>((initial.kind as CmsDocumentKind) || "");
  const [state, setState] = useState<"" | CmsPublicationState>((initial.state as CmsPublicationState) || "");
  const [q, setQ] = useState(initial.q ?? "");
  const [sort, setSort] = useState<keyof DocumentRow>((initial.sort as keyof DocumentRow) || "updated_at");
  const [dir, setDir] = useState<"asc" | "desc">(initial.dir || "desc");
  const [page, setPage] = useState(initial.page || 1);
  const issue = initial.issue || null;
  const [density, setDensity] = useStoredState<"comfortable" | "compact">("editorial-library-density", "comfortable", (value): value is "comfortable" | "compact" => value === "comfortable" || value === "compact");
  const [views, setViews] = useState<SavedView[]>(() => { try { return typeof window === "undefined" ? [] : parseSavedViews(window.localStorage.getItem(SAVED_VIEWS_KEY)); } catch { return []; } });
  const [viewsOpen, setViewsOpen] = useState(false);
  const closeViews = useCallback(() => setViewsOpen(false), []);
  const viewsRef = useDismiss(viewsOpen, closeViews);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState(0);
  const [busy, setBusy] = useState(false);
  const debouncedQ = useDebounced(q, 250);
  const tableRef = useRef<HTMLTableElement>(null);

  const persistViews = (next: SavedView[]) => { setViews(next); try { window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next)); } catch { /* keep for this visit */ } };

  // Keep the URL shareable without re-rendering through the router.
  useEffect(() => {
    const url = new URL(window.location.href);
    const set = (key: string, value: string | null) => { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); };
    set("kind", kind); set("state", state); set("q", debouncedQ.trim()); set("sort", sort === "updated_at" ? "" : sort); set("dir", dir === "desc" ? "" : dir); set("page", page > 1 ? String(page) : "");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [kind, state, debouncedQ, sort, dir, page]);
  // A filter change starts from the first page with nothing selected.
  const filterKey = JSON.stringify([kind, state, debouncedQ, brand, issue]);
  const [seenFilterKey, setSeenFilterKey] = useState(filterKey);
  if (seenFilterKey !== filterKey) { setSeenFilterKey(filterKey); setPage(1); setSelected(new Set()); setFocused(0); }

  const query = useMemo(() => ({ brand, kind, state, q: debouncedQ, page, issue }), [brand, kind, state, debouncedQ, page, issue]);
  const result = useAsync(`library:${JSON.stringify(query)}:${mutationVersion}`, signal => data.listDocuments(query, signal));
  const overview = useAsync(`library-overview:${brand}:${mutationVersion}`, signal => data.overview(brand, signal));
  const rows = useMemo(() => result.data ? sortBy(result.data.documents, sort, dir) : [], [result.data, sort, dir]);
  const total = result.data?.total ?? 0;
  const pageSize = result.data?.pageSize ?? 50;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const allSelected = rows.length > 0 && rows.every(row => selected.has(row.id));

  const toggleSort = (key: keyof DocumentRow) => {
    if (sort === key) setDir(current => current === "asc" ? "desc" : "asc");
    else { setSort(key); setDir(key === "title" || key === "byline" || key === "kind" ? "asc" : "desc"); }
  };
  const toggleRow = (id: string) => setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const onTableKey = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" && (target as HTMLInputElement).type !== "checkbox") return;
    if (event.key === "j" || event.key === "ArrowDown") { event.preventDefault(); setFocused(value => Math.min(rows.length - 1, value + 1)); }
    else if (event.key === "k" || event.key === "ArrowUp") { event.preventDefault(); setFocused(value => Math.max(0, value - 1)); }
    else if (event.key === "Enter" && rows[focused]) { event.preventDefault(); router.push(href(`/cms/doc/${rows[focused].id}`)); }
    else if ((event.key === "x" || event.key === " ") && rows[focused]) { event.preventDefault(); toggleRow(rows[focused].id); }
    else if (event.key === "Escape") setSelected(new Set());
  };
  useEffect(() => { tableRef.current?.querySelector<HTMLElement>(`tr[data-index="${focused}"]`)?.scrollIntoView({ block: "nearest" }); }, [focused]);

  async function bulkState(next: CmsPublicationState) {
    const targets = rows.filter(row => selected.has(row.id) && row.publication_state !== next && row.publication_state !== "published");
    if (!targets.length) { toast("Published items keep their state; nothing to change.", "default"); return; }
    setBusy(true);
    let done = 0, failed = 0;
    for (const row of targets) {
      try { await data.saveDocument(row.id, row.revision, { publication_state: next }); done++; }
      catch { failed++; }
    }
    setBusy(false); setSelected(new Set()); refresh();
    toast(failed ? `${done} updated, ${failed} could not be changed.` : `${done} moved to ${STATE_LABELS[next].toLowerCase()}.`, failed ? "error" : "success");
  }

  function exportCsv() {
    const chosen = rows.filter(row => selected.size ? selected.has(row.id) : true);
    const header = ["Title", "Type", "Status", "Byline", "Source", "Updated", "Published", "Link"];
    const lines = chosen.map(row => [row.title, CONTENT_TYPE_LABELS[row.kind].singular, STATE_LABELS[row.publication_state], row.byline, SOURCE_SYSTEM_LABELS[row.source_system].short, row.updated_at, row.published_at ?? "", `${window.location.origin}${href(`/cms/doc/${row.id}`)}`].map(csvCell).join(","));
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = Object.assign(document.createElement("a"), { href: url, download: `${brand}-library-${new Date().toISOString().slice(0, 10)}.csv` });
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const currentFilters: LibraryFilters = { kind, state, q: debouncedQ, sort: String(sort), dir };
  const applyView = (view: SavedView) => { setKind((view.filters.kind as CmsDocumentKind) || ""); setState((view.filters.state as CmsPublicationState) || ""); setQ(view.filters.q || ""); setSort((view.filters.sort as keyof DocumentRow) || "updated_at"); setDir(view.filters.dir || "desc"); setViewsOpen(false); };
  const stateCounts: Partial<Record<string, number>> = overview.data ? { "": overview.data.total, draft: overview.data.drafts, review: overview.data.review } : {};

  return <>
    <PageHeader icon={LibraryBig} title={kind ? CONTENT_TYPE_LABELS[kind].plural : state ? `${STATE_LABELS[state]} content` : "All content"} lede={kind ? `Every ${CONTENT_TYPE_LABELS[kind].singular.toLowerCase()} in this publication, with its source and state.` : "Every article, rating, page and imported record for this publication, with its source and state."}
      actions={<>
        <div ref={viewsRef} style={{ position: "relative" }}>
          <Button icon={Bookmark} aria-haspopup="menu" aria-expanded={viewsOpen} onClick={() => setViewsOpen(value => !value)}>Views{views.length ? ` (${views.length})` : ""}</Button>
          {viewsOpen && <div role="menu" className="ed-menu" data-align="right" style={{ minWidth: 260 }}>
            <p className="ed-menu-label">Saved views</p>
            {views.length ? views.map(view => <div key={view.id} style={{ display: "flex", alignItems: "center" }}>
              <button role="menuitem" className="ed-menu-item" style={{ flex: 1 }} onClick={() => applyView(view)}><Bookmark size={14} aria-hidden /><span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{view.name}</span></button>
              <IconButton label={`Delete view ${view.name}`} icon={Trash2} small onClick={() => persistViews(views.filter(item => item.id !== view.id))} />
            </div>) : <p style={{ padding: "4px 8px 8px", fontSize: 12.5, color: "var(--muted)" }}>Save the current filters to come back to them.</p>}
            <div className="ed-menu-sep" />
            <button role="menuitem" className="ed-menu-item" onClick={() => { const name = window.prompt("Name this view"); if (name) { persistViews(addSavedView(views, name, currentFilters)); toast("View saved", "success"); } setViewsOpen(false); }}><Plus size={14} aria-hidden /><span>Save current filters…</span></button>
          </div>}
        </div>
        <Button icon={Download} onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>
        <Button variant="primary" icon={Plus} onClick={() => openCreate()}>New document</Button>
      </>}>
      <div className="ed-toolbar">
        <div className="ed-search" style={{ flex: "1 1 260px", maxWidth: 420 }}>
          <Search size={14} aria-hidden />
          <input className="ed-input" value={q} onChange={event => setQ(event.target.value)} placeholder="Search titles…" aria-label="Search titles" />
          {q && <button type="button" className="ed-icon-button small" aria-label="Clear search" onClick={() => setQ("")}><X size={13} aria-hidden /></button>}
        </div>
        <Segmented label="Status" value={state} onChange={setState} options={STATES.map(item => ({ ...item, count: stateCounts[item.id] }))} />
        <span className="spacer" />
        <select className="ed-select" style={{ width: "auto", minWidth: 160 }} aria-label="Content type" value={kind} onChange={event => setKind(event.target.value as CmsDocumentKind | "")}>
          <option value="">All types</option>
          {CMS_DOCUMENT_KINDS.map(item => <option key={item} value={item}>{CONTENT_TYPE_LABELS[item].plural}</option>)}
        </select>
        <IconButton label={density === "compact" ? "Comfortable rows" : "Compact rows"} icon={Rows3} aria-pressed={density === "compact"} onClick={() => setDensity(density === "compact" ? "comfortable" : "compact")} />
      </div>
      {issue && <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 12, fontSize: 13, color: "var(--muted)" }}>Showing candidates from one print issue.<Link className="ed-link" href={href("/cms/library")}>Show everything</Link></div>}
    </PageHeader>

    <Card pad={false} className="still">
      {result.error && <div style={{ padding: 16 }}><p role="alert" style={{ color: "var(--negative)", fontSize: 13 }}>{result.error}</p><Button size="sm" onClick={result.reload} style={{ marginTop: 8 }}>Try again</Button></div>}
      {result.loading && !result.data ? <div style={{ padding: 20 }}><SkeletonRows rows={8} /></div> : rows.length ? <div className="ed-table-wrap">
        <table ref={tableRef} className="ed-table" data-density={density} onKeyDown={onTableKey} aria-rowcount={total}>
          <thead><tr>
            <th className="check"><input type="checkbox" className="ed-checkbox" aria-label="Select all on this page" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map(row => row.id)))} /></th>
            {COLUMNS.map(column => <th key={column.key} className={column.className} aria-sort={sort === column.key ? (dir === "asc" ? "ascending" : "descending") : undefined}>
              {column.sortable ? <button type="button" onClick={() => toggleSort(column.key)}>{column.label}{sort === column.key && (dir === "asc" ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />)}</button> : column.label}
            </th>)}
          </tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={row.id} data-index={index} data-selected={selected.has(row.id)} data-focused={index === focused} onClick={event => { if ((event.target as HTMLElement).closest("a, input, button")) return; setFocused(index); router.push(href(`/cms/doc/${row.id}`)); }} style={{ cursor: "pointer" }}>
              <td className="check"><input type="checkbox" className="ed-checkbox" aria-label={`Select ${row.title}`} checked={selected.has(row.id)} onChange={() => toggleRow(row.id)} onFocus={() => setFocused(index)} /></td>
              <td><div className="title-cell"><Link href={href(`/cms/doc/${row.id}`)} tabIndex={-1}>{row.title || "Untitled"}</Link>{row.excerpt && <small>{row.excerpt}</small>}</div></td>
              <td className="muted">{CONTENT_TYPE_LABELS[row.kind].singular}</td>
              <td><Pill tone={row.publication_state} /></td>
              <td className="muted">{row.byline || "—"}</td>
              <td className="muted" title={SOURCE_SYSTEM_LABELS[row.source_system].detail}>{SOURCE_SYSTEM_LABELS[row.source_system].short}</td>
              <td className="num muted" title={new Date(row.updated_at).toLocaleString()}>{relativeTime(row.updated_at)}</td>
              <td className="num muted">{row.published_at ? formatDate(row.published_at, { month: "short", day: "numeric", year: "numeric" }) : "—"}</td>
            </tr>)}
          </tbody>
        </table>
      </div> : !result.error && <Empty icon={LibraryBig} title={debouncedQ || kind || state ? "No matches" : "Nothing here yet"} text={debouncedQ || kind || state ? "Try a broader search or clear a filter." : "Create a document or upload a print issue to fill the library."} action={<Button variant="primary" icon={Plus} onClick={() => openCreate()}>New document</Button>} />}
    </Card>

    <div className="ed-pagination">
      <span>{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}` : "No documents"}{sort !== "updated_at" || dir !== "desc" ? " · sorted within this page" : ""} · <kbd>j</kbd> <kbd>k</kbd> move, <kbd>x</kbd> select, <kbd>↵</kbd> open</span>
      <span style={{ display: "inline-flex", gap: 6 }}>
        <Button size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</Button>
        <span style={{ alignSelf: "center" }}>Page {page} of {pages}</span>
        <Button size="sm" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>Next<ChevronRight size={14} aria-hidden /></Button>
      </span>
    </div>

    {selected.size > 0 && <div className="ed-bulk-bar" role="region" aria-label="Bulk actions">
      <span><strong>{selected.size}</strong> selected</span>
      <Button size="sm" disabled={busy} onClick={() => bulkState("review")}>Send to review</Button>
      <Button size="sm" disabled={busy} onClick={() => bulkState("draft")}>Move to drafts</Button>
      <Button size="sm" disabled={busy} onClick={() => bulkState("unpublished")}>Unpublish</Button>
      <Button size="sm" disabled={busy} icon={Download} onClick={exportCsv}>CSV</Button>
      <IconButton label="Clear selection" icon={X} small onClick={() => setSelected(new Set())} style={{ color: "inherit" }} />
    </div>}
  </>;
}
