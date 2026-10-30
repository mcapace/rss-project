"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, AlertCircle, RefreshCw } from "lucide-react";
import { BRANDS } from "@/lib/brands";
import { CMS_DOCUMENT_KINDS, type CmsBrand, type CmsMigrationInventory } from "@/lib/cms/types";
import { CONTENT_TYPE_LABELS } from "@/lib/cms/organization";
import { publicationHref } from "@/lib/cms/publications";
import "./cms.css";

const sourceLabels: Record<string, string> = {
  post_version: "Post source versions", page_version: "Page source versions", page_context: "Page content captures",
  category: "Source categories", tag: "Source tags", page_group: "Page hierarchy groups",
  gallery_definition: "Gallery definitions", gallery_version: "Gallery source versions", media_file: "Media file records",
  gallery_membership: "Gallery memberships", menu_definition: "Menu definitions", menu_item: "Menu items",
  menu_payload: "Full menu captures", media_response_context: "Media capture context", menu_response_context: "Menu capture context",
  capture_manifest: "Capture and preservation reports", source_context: "Source capture context",
  page_editor_capture: "Page editor captures", rendered_page_snapshot: "Rendered page captures", editor_diagnostic: "Editor diagnostics",
  cms_index_document: "CMS listing captures", cms_inventory_document: "CMS inventory captures", menu_embedded_page_snapshot: "Embedded page captures",
  source_part: "Parts of larger source captures",
};

export function MigrationInventory({ brand, brands }: { brand: CmsBrand; brands: CmsBrand[] }) {
  const router = useRouter();
  const [inventory, setInventory] = useState<CmsMigrationInventory | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/cms/migration/inventory?brand=${encodeURIComponent(brand)}`, { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The migration inventory could not be loaded.");
      if (!controller.signal.aborted) setInventory(body.inventory);
    }).catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "The migration inventory could not be loaded."); });
    return () => controller.abort();
  }, [brand, reload]);

  return <main className="cms-inventory-shell">
    <header className="cms-inventory-header"><Link className="cms-back" href={publicationHref("/cms", brand)}><ArrowLeft size={17} /> Content library</Link><label>Publication<select value={brand} onChange={event => router.push(publicationHref("/cms/migration", event.target.value as CmsBrand))}>{brands.map(key => <option key={key} value={key}>{BRANDS[key].name}</option>)}</select></label></header>
    <div className="cms-page-heading"><div><div className="cms-eyebrow">{BRANDS[brand].name}</div><h1>Migration inventory</h1><p>Imported content, retained source material, and work still needed.</p></div><button className="cms-button secondary" onClick={() => { setInventory(null); setError(""); setReload(value => value + 1); }}><RefreshCw size={16} />Refresh counts</button></div>
    {error && <div className="cms-alert" role="alert"><AlertCircle size={18} />{error}</div>}
    {!inventory && !error && <div className="cms-loading">Loading migration inventory…</div>}
    {inventory && <>
      <div className="cms-inventory-metrics">
        <section><span>Content records</span><strong>{inventory.documents.total.toLocaleString()}</strong><small>All types in this publication</small></section>
        <section><span>Imported from Morweb</span><strong>{inventory.documents.by_source_system.morweb.toLocaleString()}</strong><small>Preserved source identities</small></section>
        <section><span>Separate channel imports</span><strong>{inventory.documents.by_source_system.web_archive.toLocaleString()}</strong><small>Retained separately for review</small></section>
        <section><span>Import review required</span><strong>{inventory.documents.review_required.toLocaleString()}</strong><small>Retained for editorial decisions</small></section>
        <section><span>Pages awaiting assembly</span><strong>{inventory.documents.pages_awaiting_assembly.toLocaleString()}</strong><small>Page records are not finished layouts</small></section>
      </div>
      <div className="cms-inventory-columns">
        <section className="cms-inventory-section"><h2>Content in the CMS</h2><p>Every type remains available in the content library, including unclassified records.</p><table><thead><tr><th>Content type</th><th>Records</th></tr></thead><tbody>{CMS_DOCUMENT_KINDS.map(kind => <tr key={kind}><td>{CONTENT_TYPE_LABELS[kind].plural}</td><td>{inventory.documents.by_kind[kind].toLocaleString()}</td></tr>)}</tbody></table></section>
        <section className="cms-inventory-section"><h2>Retained source material</h2><p>These are supporting captures, versions, and catalogs. Multiple captures can belong to one page or story.</p><table><thead><tr><th>Source material</th><th>Records</th></tr></thead><tbody>{Object.entries(inventory.sources.by_source_kind).filter(([, count]) => count > 0).map(([kind, count]) => <tr key={kind}><td>{sourceLabels[kind] || kind.replace(/_/g, " ")}</td><td>{count.toLocaleString()}</td></tr>)}</tbody></table>{inventory.sources.total === 0 && <p>No supporting archive datasets have been imported for this publication yet.</p>}</section>
      </div>
      <section className="cms-inventory-section cms-coverage-note"><h2>Coverage still needs verification</h2><p>Imported totals show what has reached the CMS. They do not establish that every historical source page or channel archive has been captured.</p><ul><li>Check each channel’s full archive and pagination against the imported source identities.</li><li>Assemble pages from their captured content and layout blocks, and verify their images and links.</li><li>Reconcile every navigation destination, including any separately hosted event, ranking, or directory sites.</li><li>Review conflicting URLs and unclassified material before making publication or deletion decisions.</li></ul><p>Homepage promotion is separate from an article’s permanent home. Ending a placement must leave the article and its URL available.</p></section>
    </>}
  </main>;
}
