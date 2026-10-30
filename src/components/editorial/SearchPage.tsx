"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText, ImageIcon, Search as SearchIcon, Sparkles, Tag as TagIcon, X } from "lucide-react";
import { CONTENT_TYPE_LABELS } from "@/lib/cms/organization";
import { BRAND_NAMES, relativeTime } from "@/lib/editorial/helpers";
import type { SearchMediaHit, SearchResponse, SearchScope } from "@/lib/editorial/search-types";
import { cropStyle } from "@/lib/editorial/image-tools";
import { useEditorial } from "./EditorialProvider";
import { useAsync, useDebounced } from "./hooks";
import { useShell } from "./Shell";
import { BrandDot, Button, Card, Empty, Notice, PageHeader, Pill, Segmented, SkeletonRows, Tag } from "./ui";

export function PlainImage({ src, alt, style }: { src: string; alt: string; style?: React.CSSProperties }) {
  // eslint-disable-next-line @next/next/no-img-element -- Presigned S3 and data URLs cannot go through the image optimizer.
  return <img src={src} alt={alt} style={style} />;
}

/** Render a highlighted snippet without trusting it as HTML: only <mark> survives. */
export function Marked({ text }: { text: string }) {
  const parts = text.split(/(<mark>[\s\S]*?<\/mark>)/g);
  return <>{parts.map((part, index) => part.startsWith("<mark>") ? <mark key={index}>{part.slice(6, -7)}</mark> : <span key={index}>{part.replace(/<[^>]+>/g, "")}</span>)}</>;
}

export function MediaThumb({ hit, size }: { hit: SearchMediaHit; size?: "sm" }) {
  const crops = (hit.crops && typeof hit.crops === "object" ? hit.crops : {}) as Record<string, { x: number; y: number; w: number; h: number }>;
  const crop = crops["4:3"] ?? crops["16:9"] ?? crops["3:2"] ?? null;
  const palette = Array.isArray(hit.palette) ? (hit.palette as string[]) : [];
  return <div className="ed-media-tile" data-lead={hit.is_lead} style={size === "sm" ? { width: 64, height: 48, aspectRatio: "auto" } : undefined}>
    {hit.preview_url ? <PlainImage src={hit.preview_url} alt={hit.alt ?? ""} style={cropStyle(crop)} /> : <div className="ed-media-placeholder" style={{ background: palette.length ? `linear-gradient(135deg, ${palette.slice(0, 3).join(", ")})` : undefined }}><ImageIcon size={18} aria-hidden style={{ color: palette.length ? "rgb(255 255 255 / 0.8)" : undefined }} /></div>}
    {hit.is_lead && <span>Lead</span>}
  </div>;
}

const SCOPES: { id: SearchScope; label: string }[] = [{ id: "all", label: "Everything" }, { id: "documents", label: "Content" }, { id: "media", label: "Images" }, { id: "keywords", label: "Keywords" }];
const EXAMPLES = ["barrels in a dark warehouse", "harvest report", "sky blue vineyard", "Bourbon", "overhead flat lay", "Sample Editor"];

export function SearchPage({ initialQuery, initialScope }: { initialQuery: string; initialScope: string }) {
  const { brand, data, href, demo } = useEditorial();
  const { openAssistant } = useShell();
  const [query, setQuery] = useState(initialQuery);
  const [scope, setScope] = useState<SearchScope>(SCOPES.some(item => item.id === initialScope) ? (initialScope as SearchScope) : "all");
  const [allBrands, setAllBrands] = useState(false);
  const debounced = useDebounced(query, 250);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (debounced.trim()) url.searchParams.set("q", debounced.trim()); else url.searchParams.delete("q");
    if (scope !== "all") url.searchParams.set("scope", scope); else url.searchParams.delete("scope");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [debounced, scope]);
  const enabled = debounced.trim().length >= 2 || scope === "keywords";
  const result = useAsync(`search:${debounced}:${scope}:${allBrands ? "all" : brand}`, signal => data.search(debounced.trim(), { brand: allBrands ? null : brand, scope, limit: 30 }, signal), { enabled });
  const response: SearchResponse | null = result.data;
  const setupError = result.error && /set up|migration/i.test(result.error);

  return <>
    <PageHeader icon={SearchIcon} title="Search" lede="Titles, body text, bylines, tags, captions and image descriptions. Describe an image by its look when you do not know the file name.">
      <div className="ed-toolbar">
        <div className="ed-search ed-search-hero" style={{ flex: "1 1 320px" }}>
          <SearchIcon size={18} aria-hidden />
          <input className="ed-input" autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search content, images and keywords…" aria-label="Search" />
          {query && <button type="button" className="ed-icon-button small" aria-label="Clear search" onClick={() => setQuery("")}><X size={13} aria-hidden /></button>}
        </div>
        <Segmented label="Scope" value={scope} onChange={setScope} options={SCOPES.map(item => ({ ...item, count: response ? (item.id === "documents" ? response.documents.length : item.id === "media" ? response.media.length : item.id === "keywords" ? response.keywords.length : undefined) : undefined }))} />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--muted)" }}><input type="checkbox" className="ed-checkbox" checked={allBrands} onChange={event => setAllBrands(event.target.checked)} />All publications</label>
      </div>
    </PageHeader>

    {!enabled && <Card>
      <Empty icon={Sparkles} title="Search by words or by the way an image looks" text="Images are searchable by caption, credit, file name and the AI description of their subject, style, mood and colors. Try one of these." action={<div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>{EXAMPLES.map(example => <button key={example} type="button" className="ed-keyword" onClick={() => setQuery(example)}>{example}</button>)}</div>} />
    </Card>}
    {result.error && (setupError ? <Card><Empty icon={SearchIcon} title="Search is not set up yet" text={result.error} /></Card> : <Notice tone="error">{result.error}</Notice>)}
    {enabled && result.loading && !response && <Card><SkeletonRows rows={6} /></Card>}

    {response && <div className="ed-stack">
      {(scope === "all" || scope === "media") && <Card>
        <div className="ed-section-head"><div><h2 className="ed-section-title">Images <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {response.media.length}</span></h2><p>Matched by caption, credit, file name, subject, style, mood or color.</p></div></div>
        {response.media.length ? <div className="ed-image-grid">
          {response.media.map(hit => {
            const vision = hit.vision && typeof hit.vision === "object" && "description" in hit.vision ? hit.vision : null;
            return <Link key={`${hit.document_id}:${hit.media_index}`} href={href(`/cms/doc/${hit.document_id}`, { tab: "media" })} className="ed-image-card" title={vision ? String(vision.description) : hit.caption ?? ""}>
              <MediaThumb hit={hit} />
              <span className="title">{hit.caption || hit.file || `Image ${hit.media_index + 1}`}</span>
              <span className="meta">{hit.document_title}{vision ? ` · ${String(vision.style)}` : ""}</span>
              {Array.isArray(hit.palette) && hit.palette.length > 0 && <span className="ed-swatches" aria-hidden>{(hit.palette as string[]).slice(0, 4).map(color => <i key={color} style={{ background: color }} />)}</span>}
            </Link>;
          })}
        </div> : <p style={{ fontSize: 13, color: "var(--muted)" }}>No images match. Images without an AI description are only found by caption and file name; open a story&rsquo;s Media tab and choose “Describe with AI”.</p>}
      </Card>}

      {(scope === "all" || scope === "documents") && <Card>
        <div className="ed-section-head"><div><h2 className="ed-section-title">Content <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {response.documents.length}</span></h2></div></div>
        {response.documents.length ? <div>
          {response.documents.map(hit => <div key={hit.id} className="ed-hit">
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <FileText size={14} aria-hidden style={{ color: "var(--muted)" }} />
              <Link className="title" href={href(`/cms/doc/${hit.id}`)}>{hit.title || "Untitled"}</Link>
              <Pill tone={hit.publication_state} />
              <Tag>{CONTENT_TYPE_LABELS[hit.kind].singular}</Tag>
              {allBrands && <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--muted)" }}><BrandDot brand={hit.brand} />{BRAND_NAMES[hit.brand]}</span>}
            </div>
            <span className="meta">{hit.byline ? `${hit.byline} · ` : ""}updated {relativeTime(hit.updated_at)}</span>
            {hit.headline && <p className="snippet"><Marked text={hit.headline} /></p>}
          </div>)}
        </div> : <p style={{ fontSize: 13, color: "var(--muted)" }}>No stories match “{response.query}”.</p>}
      </Card>}

      {(scope === "all" || scope === "keywords") && <Card>
        <div className="ed-section-head"><div><h2 className="ed-section-title">Keywords <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {response.keywords.length}</span></h2><p>Tags, categories and sections in use, with how many stories carry them.</p></div></div>
        {response.keywords.length ? <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {response.keywords.map(keyword => <Link key={`${keyword.kind}:${keyword.keyword}`} className="ed-keyword" href={href("/cms/library", { q: keyword.keyword })} title={keyword.kind}><TagIcon size={12} aria-hidden />{keyword.keyword}<em>{keyword.document_count}</em></Link>)}
        </div> : <p style={{ fontSize: 13, color: "var(--muted)" }}>No keywords match.</p>}
      </Card>}

      <Card flat pad="sm">
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, fontSize: 12.5, color: "var(--muted)" }}>
          <Sparkles size={14} aria-hidden />You can also search from the assistant: ask “find images of barrels” or “show me stories about harvest”.
          <Button size="sm" variant="subtle" style={{ marginLeft: "auto" }} onClick={() => openAssistant(query ? `find ${query}` : undefined)} ai>Open assistant</Button>
          {demo && <span>Demo results come from the sample library.</span>}
        </div>
      </Card>
    </div>}
  </>;
}
