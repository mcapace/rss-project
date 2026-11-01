"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, ExternalLink, Film, FileImage, Images, Search as SearchIcon, X } from "lucide-react";
import type { MediaFile, MediaGallery } from "@/lib/editorial/media-library-types";
import { useEditorial } from "./EditorialProvider";
import { useAsync, useDebounced } from "./hooks";
import { PlainImage } from "./SearchPage";
import { Button, Card, Empty, Notice, PageHeader, Pill, Segmented, SidePanel, SkeletonRows } from "./ui";

const PAGE = 60;
type StatusFilter = "all" | "stored" | "pending" | "failed";

function size(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
function day(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
const statusLabel: Record<MediaFile["status"], string> = { stored: "In S3", pending: "Copying", failed: "Not copied" };
const statusTone: Record<MediaFile["status"], string> = { stored: "published", pending: "queued", failed: "failed" };

/** The Morweb gallery library: every gallery and file, with its S3 copy and the stories that use it. */
export function MediaLibrary({ initialGallery, initialQuery }: { initialGallery: string | null; initialQuery: string }) {
  const { brand, data, href, demo, toast } = useEditorial();
  const [gallery, setGallery] = useState<string | null>(initialGallery);
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<MediaFile | null>(null);
  const q = useDebounced(query.trim(), 250);
  const browsing = !gallery && !q;
  // The page belongs to the filters it was chosen under; a new gallery, search, status or publication starts at the first page.
  const scope = `${brand}:${gallery ?? ""}:${q}:${status}`;
  const [page, setPage] = useState({ scope, offset: 0 });
  const offset = page.scope === scope ? page.offset : 0;
  const setOffset = (next: number) => setPage({ scope, offset: next });

  useEffect(() => {
    const url = new URL(window.location.href);
    if (gallery) url.searchParams.set("gallery", gallery); else url.searchParams.delete("gallery");
    if (q) url.searchParams.set("q", q); else url.searchParams.delete("q");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [gallery, q]);

  const overview = useAsync(`media-library:${brand}`, signal => data.mediaLibrary(brand, signal));
  const files = useAsync(`media-files:${brand}:${gallery ?? ""}:${q}:${status}:${offset}`, signal => data.mediaFiles(brand, { gallery, q, status: status === "all" ? "" : status, offset, limit: PAGE }, signal), { enabled: !browsing });
  const current: MediaGallery | null = useMemo(() => overview.data?.galleries.find(g => g.id === gallery) ?? null, [overview.data, gallery]);
  const totals = overview.data?.totals;

  async function copy(text: string, what: string) {
    try { await navigator.clipboard.writeText(text.startsWith("/") ? `${window.location.origin}${text}` : text); toast(`${what} copied.`, "success"); }
    catch { toast("Copy is blocked in this browser; select the address instead.", "error"); }
  }

  return <>
    <PageHeader icon={Images} title="Media" lede="The Morweb gallery library: every gallery and every uploaded file, kept in our S3 bucket, with the stories that use each one.">
      <div className="ed-toolbar">
        <div className="ed-search ed-search-hero" style={{ flex: "1 1 320px" }}>
          <SearchIcon size={18} aria-hidden />
          <input className="ed-input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search every file by name…" aria-label="Search files by name" />
          {query && <button type="button" className="ed-icon-button small" aria-label="Clear search" onClick={() => setQuery("")}><X size={13} aria-hidden /></button>}
        </div>
        {!browsing && <Segmented label="Copy status" value={status} onChange={setStatus} options={[{ id: "all", label: "All" }, { id: "stored", label: "In S3" }, { id: "pending", label: "Copying" }, { id: "failed", label: "Not copied" }]} />}
      </div>
    </PageHeader>

    {demo && <Notice>The demo shows a small sample. The connected workspace lists all 118 Morweb galleries and their files.</Notice>}
    {overview.error && <Notice tone="error">{overview.error}</Notice>}

    {totals && totals.files > 0 && <Card pad={false}>
      <div className="ed-kpi-strip ed-media-kpis">
        <div className="ed-kpi"><span className="ed-kpi-label">Galleries</span><strong>{totals.galleries.toLocaleString()}</strong><small>From Morweb</small></div>
        <div className="ed-kpi"><span className="ed-kpi-label">Files</span><strong>{totals.files.toLocaleString()}</strong><small>{size(totals.bytes)}</small></div>
        <div className="ed-kpi"><span className="ed-kpi-label">In S3</span><strong>{totals.stored.toLocaleString()}</strong><small>{Math.round((totals.stored / totals.files) * 100)}% copied</small></div>
        <div className="ed-kpi"><span className="ed-kpi-label">Still to copy</span><strong>{(totals.pending + totals.failed).toLocaleString()}</strong><small>{totals.failed ? `${totals.failed.toLocaleString()} could not be fetched` : "Copying from Morweb"}</small></div>
      </div>
    </Card>}

    {browsing && <Card>
      <div className="ed-section-head"><div><h2 className="ed-section-title">Galleries</h2><p>As they were organized in Morweb. Open one to see its files.</p></div></div>
      {overview.loading && !overview.data ? <SkeletonRows rows={6} /> : overview.data?.galleries.length ? <div className="ed-gallery-grid">
        {overview.data.galleries.map(g => <button key={g.id} type="button" className="ed-gallery-card" onClick={() => setGallery(g.id)}>
          <span className="ed-media-tile">{g.cover ? <PlainImage src={g.cover} alt="" /> : <span className="ed-media-placeholder"><FileImage size={22} aria-hidden /></span>}</span>
          <span className="title">{g.title}</span>
          <span className="meta">{g.files.toLocaleString()} files · {size(g.bytes)} · {day(g.created_at)}</span>
          {g.stored < g.files && <span className="meta">{g.stored.toLocaleString()} in S3{g.failed ? ` · ${g.failed} not copied` : ""}</span>}
        </button>)}
      </div> : <Empty icon={Images} title="No galleries yet" text="The gallery catalog has not been imported for this publication." />}
    </Card>}

    {!browsing && <Card>
      <div className="ed-section-head">
        <div>
          <button type="button" className="ed-back" onClick={() => { setGallery(null); setQuery(""); }}><ArrowLeft size={14} aria-hidden />All galleries</button>
          <h2 className="ed-section-title">{q ? `Files matching “${q}”${current ? ` in ${current.title}` : ""}` : current?.title ?? "Gallery"} {files.data && <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {files.data.total.toLocaleString()}</span>}</h2>
          {current && !q && <p>{current.files.toLocaleString()} files · {size(current.bytes)} · created {day(current.created_at)}</p>}
        </div>
      </div>
      {files.error && <Notice tone="error">{files.error}</Notice>}
      {files.loading && !files.data ? <SkeletonRows rows={6} /> : files.data?.files.length ? <>
        <div className="ed-image-grid ed-library-grid">
          {files.data.files.map(file => <button key={`${file.gallery_id}:${file.id}`} type="button" className="ed-image-card" onClick={() => setSelected(file)} title={file.file_name}>
            <span className="ed-media-tile">
              {file.thumb ? <PlainImage src={file.thumb} alt={file.alt || ""} /> : <span className="ed-media-placeholder">{/^video\//.test(file.mime) ? <Film size={22} aria-hidden /> : <FileImage size={22} aria-hidden />}</span>}
              {file.status !== "stored" && <span>{statusLabel[file.status]}</span>}
            </span>
            <span className="title">{file.file_name}</span>
            <span className="meta">{[file.width && file.height ? `${file.width}×${file.height}` : null, size(file.bytes), file.used_in.length ? `${file.used_in.length} ${file.used_in.length === 1 ? "story" : "stories"}` : null, !gallery ? file.gallery : null].filter(Boolean).join(" · ")}</span>
          </button>)}
        </div>
        {files.data.total > PAGE && <div className="ed-pager">
          <Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
          <span>{(offset + 1).toLocaleString()}–{Math.min(offset + PAGE, files.data.total).toLocaleString()} of {files.data.total.toLocaleString()}</span>
          <Button size="sm" disabled={offset + PAGE >= files.data.total} onClick={() => setOffset(offset + PAGE)}>Next</Button>
        </div>}
      </> : <Empty icon={Images} title="No files here" text={q ? "No file names match. Try part of the name." : "This gallery has no files with that status."} />}
    </Card>}

    <SidePanel open={!!selected} onClose={() => setSelected(null)} title={selected?.file_name ?? "File"}
      footer={selected && <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {selected.original && <a className="ed-button" href={selected.original} target="_blank" rel="noopener"><ExternalLink size={14} aria-hidden />Open original</a>}
        {selected.public_url && <Button icon={Copy} onClick={() => copy(selected.public_url!, "Site address")}>Copy site address</Button>}
        <Button icon={Copy} variant="subtle" onClick={() => copy(selected.source_url, "Morweb address")}>Copy Morweb address</Button>
      </div>}>
      {selected && <div className="ed-stack">
        <div className="ed-library-preview">
          {selected.original && /^image\//.test(selected.mime) ? <PlainImage src={selected.thumb ? selected.thumb.replace(/([?&])w=\d+/, "$1w=1200") : selected.original} alt={selected.alt || ""} />
            : selected.original && /^video\//.test(selected.mime) ? <video src={selected.original} controls preload="metadata" />
            : <span className="ed-media-placeholder"><FileImage size={28} aria-hidden /></span>}
        </div>
        <dl className="ed-library-facts">
          <div><dt>Status</dt><dd><Pill tone={statusTone[selected.status]}>{statusLabel[selected.status]}</Pill>{selected.error ? <small> {selected.error}</small> : null}</dd></div>
          <div><dt>Gallery</dt><dd>{selected.gallery ?? current?.title ?? selected.gallery_id}</dd></div>
          <div><dt>Type</dt><dd>{selected.mime || "—"}</dd></div>
          <div><dt>Dimensions</dt><dd>{selected.width && selected.height ? `${selected.width} × ${selected.height}` : "—"}</dd></div>
          <div><dt>Size</dt><dd>{size(selected.bytes)}</dd></div>
          <div><dt>Uploaded</dt><dd>{day(selected.uploaded_at)}</dd></div>
          {selected.alt && <div><dt>Alt text</dt><dd>{selected.alt}</dd></div>}
        </dl>
        <div>
          <h3 className="ed-library-sub">Used in</h3>
          {selected.used_in.length ? <ul className="ed-library-uses">{selected.used_in.map(doc => <li key={doc.id}><Link href={href(`/cms/doc/${doc.id}`, { tab: "media" })}>{doc.title || "Untitled"}</Link><Pill tone={doc.state} /></li>)}</ul>
            : <p className="ed-library-none">No story uses this file.</p>}
        </div>
      </div>}
    </SidePanel>
  </>;
}
