"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import type { CatalogEntry, CatalogType } from "@/lib/editorial/platform-types";
import { useEditorial } from "./EditorialProvider";
import { useDebounced, useDismiss } from "./hooks";

const LABELS: Record<CatalogType, string> = { producer: "Producer", region: "Region", variety: "Variety", taster: "Taster" };

/**
 * A typeahead over the relational catalog. Typing searches the publication's
 * producers, regions, varieties or tasters; choosing one fills the field with
 * its exact name so the saved rating joins the existing row instead of
 * creating a near-duplicate. A new name is allowed and becomes a catalog row
 * on save.
 */
export function CatalogField({ type, value, onChange, label = LABELS[type], hint, placeholder }: { type: CatalogType; value: string; onChange: (value: string) => void; label?: string; hint?: string; placeholder?: string }) {
  const { brand, data, demo } = useEditorial();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [active, setActive] = useState(-1);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const debounced = useDebounced(value, 200);
  const latest = useRef(0);

  useEffect(() => {
    if (!open) return;
    const token = ++latest.current;
    data.catalogLookup(brand, type, debounced.trim()).then(result => { if (latest.current === token) { setEntries(result); setActive(-1); } }).catch(() => { if (latest.current === token) setEntries([]); });
  }, [open, debounced, brand, type, data]);

  const exact = entries.some(entry => entry.name.toLowerCase() === value.trim().toLowerCase());
  const choose = (name: string) => { onChange(name); setOpen(false); };

  return <div ref={ref} className="ed-field ed-catalog-field">
    <label htmlFor={id}>{label}</label>
    <input id={id} className="ed-input" value={value} placeholder={placeholder} autoComplete="off" role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
      onChange={event => { onChange(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
      onKeyDown={event => {
        if (!open) return;
        if (event.key === "ArrowDown") { event.preventDefault(); setActive(current => Math.min(entries.length - 1, current + 1)); }
        else if (event.key === "ArrowUp") { event.preventDefault(); setActive(current => Math.max(-1, current - 1)); }
        else if (event.key === "Enter" && active >= 0 && entries[active]) { event.preventDefault(); choose(entries[active].name); }
        else if (event.key === "Escape") setOpen(false);
      }} />
    {open && (entries.length > 0 || value.trim()) && <div id={`${id}-list`} role="listbox" className="ed-menu ed-catalog-menu">
      {entries.map((entry, index) => <button key={entry.id} type="button" role="option" aria-selected={index === active} className="ed-menu-item" data-active={index === active} onMouseDown={event => event.preventDefault()} onClick={() => choose(entry.name)}>
        <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.name}</span>{(entry.detail || entry.document_count > 0) && <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)" }}>{[entry.detail, entry.document_count ? `${entry.document_count} rating${entry.document_count === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")}</span>}</span>
        {entry.name === value && <Check size={14} aria-hidden />}
      </button>)}
      {value.trim() && !exact && <button type="button" role="option" aria-selected={false} className="ed-menu-item" onMouseDown={event => event.preventDefault()} onClick={() => choose(value.trim())}><Plus size={14} aria-hidden /><span>Add “{value.trim()}” as a new {LABELS[type].toLowerCase()}{demo ? " (demo)" : ""}</span></button>}
    </div>}
    {hint && <small>{hint}</small>}
  </div>;
}
