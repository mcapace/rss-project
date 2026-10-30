"use client";

import { Archive } from "lucide-react";
import { CMS_DOCUMENT_KINDS, CMS_PUBLICATION_STATES } from "@/lib/cms/types";
import { CONTENT_TYPE_LABELS, SOURCE_SYSTEM_LABELS } from "@/lib/cms/organization";
import { BRAND_NAMES, STATE_LABELS } from "@/lib/editorial/helpers";
import { useEditorial } from "./EditorialProvider";
import { useAsync } from "./hooks";
import { Card, Notice, PageHeader, SectionHead, SkeletonRows } from "./ui";

function Bars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map(row => row.value));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return <div style={{ display: "grid", gap: 10 }}>
    {rows.map(row => <div key={row.label}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}><span>{row.label}</span><span className="tabular" style={{ color: "var(--muted)" }}>{row.value.toLocaleString()}{total ? ` · ${Math.round(row.value / total * 100)}%` : ""}</span></div>
      <div className="ed-progress" style={{ marginTop: 5 }}><i style={{ width: `${row.value / max * 100}%` }} /></div>
    </div>)}
  </div>;
}

export function MigrationView() {
  const { brand, data, mutationVersion } = useEditorial();
  const inventory = useAsync(`inventory:${brand}:${mutationVersion}`, signal => data.inventory(brand, signal));
  const inv = inventory.data;
  return <>
    <PageHeader icon={Archive} title="Migration inventory" lede={`Coverage of the preserved ${BRAND_NAMES[brand]} archive: what became editable records, what still needs a decision, and the raw evidence kept behind it.`} />
    {inventory.error && <Notice tone="error">{inventory.error}</Notice>}
    {!inv ? <Card><SkeletonRows rows={6} /></Card> : <div className="ed-stack">
      <Card pad={false} className="still">
        <div className="ed-kpi-strip">
          {[
            { label: "Documents", value: inv.documents.total, hint: "Editable records in this publication" },
            { label: "Review required", value: inv.documents.review_required, hint: "Held for an editorial decision" },
            { label: "Pages awaiting assembly", value: inv.documents.pages_awaiting_assembly, hint: "Page metadata without an assembled body" },
            { label: "Source records", value: inv.sources.total, hint: `${inv.sources.archive_count} archive ${inv.sources.archive_count === 1 ? "capture" : "captures"}` },
          ].map(kpi => <div key={kpi.label} className="ed-kpi"><span className="ed-kpi-label">{kpi.label}</span><strong>{kpi.value.toLocaleString()}</strong><small>{kpi.hint}</small></div>)}
        </div>
      </Card>
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}>
        <Card><SectionHead title="By content type" /><Bars rows={CMS_DOCUMENT_KINDS.map(kind => ({ label: CONTENT_TYPE_LABELS[kind].plural, value: inv.documents.by_kind[kind] ?? 0 })).filter(row => row.value > 0)} /></Card>
        <Card><SectionHead title="By publication state" /><Bars rows={CMS_PUBLICATION_STATES.map(state => ({ label: STATE_LABELS[state], value: inv.documents.by_publication_state[state] ?? 0 }))} /></Card>
        <Card><SectionHead title="By source" /><Bars rows={(["morweb", "print", "manual", "web_archive"] as const).map(source => ({ label: SOURCE_SYSTEM_LABELS[source].detail, value: inv.documents.by_source_system[source] ?? 0 }))} /></Card>
        <Card><SectionHead title="Preserved source records" detail="Raw archive evidence by kind; never rendered as page content." /><Bars rows={Object.entries(inv.sources.by_source_kind).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([kind, value]) => ({ label: kind.replace(/_/g, " "), value }))} /></Card>
      </div>
    </div>}
  </>;
}
