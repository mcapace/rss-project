"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, FileArchive } from "lucide-react";
import type { CmsMigrationSourceSummary } from "@/lib/cms/types";

type SourceList = { sources: CmsMigrationSourceSummary[]; total: number; page: number; pageSize: number };

export function MigrationSources({ documentId }: { documentId: string }) {
  const [page, setPage] = useState(1);
  const [listing, setListing] = useState<SourceList | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ id: string; text: string } | null>(null);
  const [detailError, setDetailError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/cms/documents/${documentId}/migration-sources?page=${page}`, { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Preserved sources could not be loaded.");
      if (!controller.signal.aborted) setListing(body);
    }).catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Preserved sources could not be loaded."); });
    return () => controller.abort();
  }, [documentId, page]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    fetch(`/api/cms/documents/${documentId}/migration-sources?source_id=${encodeURIComponent(selected)}`, { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "This preserved source could not be loaded.");
      if (!controller.signal.aborted) setDetail({ id: selected, text: body.payload_json });
    }).catch(err => { if (!controller.signal.aborted) setDetailError(err instanceof Error ? err.message : "This preserved source could not be loaded."); });
    return () => controller.abort();
  }, [documentId, selected]);

  function selectSource(id: string) {
    setDetail(null); setDetailError("");
    setSelected(selected === id ? null : id);
  }

  function selectPage(next: number) {
    setListing(null); setError(""); setSelected(null);
    setDetail(null); setDetailError(""); setPage(next);
  }

  return <section className="cms-captured-sources"><h2><FileArchive size={19} /> Preserved source material</h2><p className="cms-muted">Original versions and captured page content remain available for migration review. Page captures still need to be assembled into the new site’s layouts.</p>
    {error && <p className="cms-alert" role="alert"><AlertCircle size={16} />{error}</p>}
    {!listing && !error && <p className="cms-muted">Loading preserved sources…</p>}
    {listing && <>
      {listing.total === 0 ? <p className="cms-fineprint">No additional source datasets are linked to this record yet. Its original import remains in Source updates above.</p> : <>
        <p className="cms-fineprint">{listing.total.toLocaleString()} linked source records</p>
        <ul className="cms-capture-list">{listing.sources.map(source => <li key={source.id}><div><strong>{source.source_kind.replace(/_/g, " ")}</strong><small>{source.source_key}</small>{source.captured_at && <time dateTime={source.captured_at}>{new Date(source.captured_at).toLocaleString()}</time>}</div><button className="cms-button secondary small" onClick={() => selectSource(source.id)}>{selected === source.id ? "Close source" : "Inspect source"}</button></li>)}</ul>
        <div className="cms-source-pagination"><button className="cms-icon-button" aria-label="Previous source page" disabled={page <= 1} onClick={() => selectPage(page - 1)}><ChevronLeft size={16} /></button><span>Page {page} of {Math.max(1, Math.ceil(listing.total / listing.pageSize))}</span><button className="cms-icon-button" aria-label="Next source page" disabled={page * listing.pageSize >= listing.total} onClick={() => selectPage(page + 1)}><ChevronRight size={16} /></button></div>
      </>}
    </>}
    {selected && <div className="cms-capture-detail"><h3>Original captured data</h3><p className="cms-fineprint">Read-only source data. Inspecting it does not change the document.</p>{detailError ? <p className="cms-alert" role="alert">{detailError}</p> : detail?.id === selected ? <><pre tabIndex={0} aria-label="Preserved source JSON">{detail.text.slice(0, 32000)}</pre>{detail.text.length > 32000 && <p className="cms-fineprint">Showing the first 32,000 characters of this capture.</p>}<a className="cms-source-link" href={`/api/cms/documents/${documentId}/migration-sources?source_id=${encodeURIComponent(selected)}`} target="_blank" rel="noreferrer">Open the full preserved source</a></> : <p className="cms-muted">Loading original capture…</p>}</div>}
  </section>;
}
