"use client";

import { useState } from "react";
import { LayoutTemplate, Pin, PinOff, Search, X } from "lucide-react";
import type { CmsBrand } from "@/lib/cms/types";
import { BRAND_NAMES, formatDate } from "@/lib/editorial/helpers";
import type { DocumentRow } from "@/lib/editorial/data";
import { useEditorial } from "./EditorialProvider";
import { useAsync, useDebounced } from "./hooks";
import { Button, Card, Empty, Field, Notice, PageHeader, Pill, SkeletonRows } from "./ui";

type Story = { id: string; slug: string | null; title: string; byline: string; excerpt: string; section: string; date: string | null; published: boolean };
type Slot = { position: number; pinned: (Story & { label: string; ends_at: string | null; set_by: string; updated_at: string }) | null; fallback: Story | null };
type Front = { brand: CmsBrand; positions: number; labels: Record<string, string>; slots: Slot[] };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error || `Request failed (${response.status}).`);
  return body as T;
}

/**
 * The home page's news rotator: five positions, the newest five by default.
 * Pin a story into a position to feature it (a sponsored story, an older
 * feature); the newest stories fill the positions around it and skip the
 * pinned one. A pin can carry a label and an end time.
 */
export function FrontPage() {
  const { brand, demo, data, toast } = useEditorial();
  const [editing, setEditing] = useState<number | null>(null);
  const [now] = useState(() => Date.now());
  const state = useAsync(`front:${brand}`, signal => call<Front>(`/api/cms/front?brand=${brand}`, { signal }), { enabled: !demo });
  const front = demo ? null : state.data;
  const error = demo ? null : state.error;

  const save = async (position: number, documentId: string | null, label: string, endsAt: string | null) => {
    try {
      await call<Front>("/api/cms/front", { method: "PUT", body: JSON.stringify({ brand, position, document_id: documentId, label, ends_at: endsAt }) });
      toast(documentId ? `Position ${position} pinned.` : `Position ${position} back to the newest story.`, "success");
      setEditing(null);
      state.reload();
    } catch (e) { toast(e instanceof Error ? e.message : "The change did not save.", "error"); }
  };

  return <>
    <PageHeader icon={LayoutTemplate} title="Front page" lede={`The five stories in the ${BRAND_NAMES[brand]} news rotator. Newest first unless a position is pinned.`} />
    {demo && <Notice>The demo has no front page to edit. Sign in to the live workspace to pin stories.</Notice>}
    {error && <Notice tone="error">{error}</Notice>}
    {!demo && !front && !error && <Card><SkeletonRows rows={5} /></Card>}
    {front && <div className="ed-front">
      {front.slots.map(slot => {
        const shown = slot.pinned || slot.fallback;
        const expired = slot.pinned?.ends_at ? new Date(slot.pinned.ends_at).getTime() < now : false;
        return <Card key={slot.position} pad="sm" className="ed-front-slot" still>
          <div className="ed-front-row">
            <span className="ed-front-pos" aria-label={`Position ${slot.position}`}>{slot.position}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="ed-front-meta">
                {slot.pinned ? <Pill tone={expired ? "failed" : "published"}>{expired ? "Pin ended" : "Pinned"}</Pill> : <Pill plain>Newest</Pill>}
                {slot.pinned?.label && front.labels[slot.pinned.label] && <Pill tone="scheduled">{front.labels[slot.pinned.label]}</Pill>}
                {shown?.section && <span className="ed-muted">{shown.section}</span>}
                {shown?.date && <span className="ed-muted">{formatDate(shown.date)}</span>}
              </div>
              {shown ? <h3 className="ed-front-title">{shown.title}</h3> : <h3 className="ed-front-title ed-muted">Nothing to show yet</h3>}
              {shown?.byline && <p className="ed-muted">{shown.byline}</p>}
              {slot.pinned && <p className="ed-muted ed-front-note">
                {slot.pinned.ends_at ? `${expired ? "Ended" : "Until"} ${formatDate(slot.pinned.ends_at)}` : "Until cleared"}{slot.pinned.set_by ? ` · set by ${slot.pinned.set_by}` : ""}
                {expired && slot.fallback ? ` · showing the newest: ${slot.fallback.title}` : ""}
              </p>}
            </div>
            <div className="ed-front-actions">
              <Button size="sm" variant={slot.pinned ? "default" : "subtle"} icon={Pin} onClick={() => setEditing(editing === slot.position ? null : slot.position)}>{slot.pinned ? "Change" : "Pin a story"}</Button>
              {slot.pinned && <Button size="sm" variant="subtle" icon={PinOff} onClick={() => void save(slot.position, null, "", null)}>Clear</Button>}
            </div>
          </div>
          {editing === slot.position && <PinEditor brand={brand} labels={front.labels} current={slot.pinned} onCancel={() => setEditing(null)} onSave={(id, label, endsAt) => void save(slot.position, id, label, endsAt)} search={(q, signal) => data.listDocuments({ brand, kind: "article", state: "published", q }, signal)} />}
        </Card>;
      })}
      {!front.slots.some(s => s.pinned || s.fallback) && <Empty icon={LayoutTemplate} title="No published stories" text="The rotator fills from published articles." />}
    </div>}
  </>;
}

function PinEditor({ labels, current, onCancel, onSave, search }: { brand: CmsBrand; labels: Record<string, string>; current: Slot["pinned"]; onCancel: () => void; onSave: (documentId: string, label: string, endsAt: string | null) => void; search: (q: string, signal: AbortSignal) => Promise<{ documents: DocumentRow[] }> }) {
  const [q, setQ] = useState("");
  const debounced = useDebounced(q, 250);
  const [chosen, setChosen] = useState<{ id: string; title: string } | null>(current ? { id: current.id, title: current.title } : null);
  const [label, setLabel] = useState(current?.label || "");
  const [endsAt, setEndsAt] = useState(current?.ends_at ? current.ends_at.slice(0, 10) : "");
  const found = useAsync(`front-search:${debounced}`, signal => search(debounced, signal), { enabled: Boolean(debounced.trim()) });
  const results: DocumentRow[] = debounced.trim() ? (found.data?.documents.slice(0, 8) ?? []) : [];
  const busy = Boolean(debounced.trim()) && found.loading;

  return <div className="ed-front-editor">
    <Field label="Story" hint="Search published articles by title.">
      <div className="ed-front-search">
        <Search size={14} aria-hidden />
        <input className="ed-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Start typing a headline" aria-label="Search stories" />
      </div>
      {chosen && <div className="ed-front-chosen"><Pin size={13} aria-hidden /><span>{chosen.title}</span><button type="button" aria-label="Remove" onClick={() => setChosen(null)}><X size={13} /></button></div>}
      {(results.length > 0 || busy) && <ul className="ed-front-results" role="listbox">
        {busy && results.length === 0 && <li className="ed-muted">Searching</li>}
        {results.map(row => <li key={row.id}><button type="button" role="option" aria-selected={chosen?.id === row.id} onClick={() => { setChosen({ id: row.id, title: row.title }); setQ(""); }}>
          <span>{row.title}</span><small className="ed-muted">{row.byline || ""}{row.published_at ? ` · ${formatDate(row.published_at)}` : ""}</small>
        </button></li>)}
      </ul>}
    </Field>
    <div className="ed-front-fields">
      <Field label="Label" htmlFor="front-label" hint="Shown on the card. A paid placement must say Sponsored.">
        <select id="front-label" className="ed-select" value={label} onChange={e => setLabel(e.target.value)}>{Object.entries(labels).map(([key, name]) => <option key={key || "none"} value={key}>{name}</option>)}</select>
      </Field>
      <Field label="Until" htmlFor="front-until" hint="Optional. After this day the position goes back to the newest story.">
        <input id="front-until" className="ed-input" type="date" value={endsAt} onChange={e => setEndsAt(e.target.value)} />
      </Field>
    </div>
    <div className="ed-front-editor-actions">
      <Button variant="primary" disabled={!chosen} onClick={() => chosen && onSave(chosen.id, label, endsAt ? `${endsAt}T23:59:59Z` : null)}>Pin to this position</Button>
      <Button variant="subtle" onClick={onCancel}>Cancel</Button>
    </div>
  </div>;
}
