"use client";

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CornerDownLeft, FileText, Newspaper, Plus, Search, Star, SunMoon, type LucideIcon } from "lucide-react";
import type { CmsBrand } from "@/lib/cms/types";
import { BRAND_NAMES, brandColor, matchScore, relativeTime, STATE_LABELS } from "@/lib/editorial/helpers";
import type { DocumentRow } from "@/lib/editorial/data";
import { useEditorial } from "./EditorialProvider";
import { useDebounced, useLayer, useTheme } from "./hooks";
import { ALL_NAV } from "./nav";
import { useShell } from "./Shell";

type Item = { id: string; group: string; label: string; detail?: string; icon: LucideIcon; keywords?: string; dot?: string; run: () => void };

/** ⌘K anywhere: jump to a page, switch publication, create, or open a document by title. */
export function CommandPalette() {
  const router = useRouter();
  const { commandOpen, setCommandOpen, href, brand, brands, setBrand, data, demo } = useEditorial();
  const { openCreate } = useShell();
  const { toggle: toggleTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<DocumentRow[]>([]);
  const [searchedFor, setSearchedFor] = useState("");
  const debounced = useDebounced(query, 220);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setCommandOpen(false), [setCommandOpen]);
  const layerRef = useLayer(commandOpen, close);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen(!commandOpen); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commandOpen, setCommandOpen]);

  const [wasOpen, setWasOpen] = useState(commandOpen);
  if (wasOpen !== commandOpen) { setWasOpen(commandOpen); if (commandOpen) { setQuery(""); setActive(0); setResults([]); } }
  useEffect(() => { if (commandOpen) { const timer = setTimeout(() => inputRef.current?.focus(), 10); return () => clearTimeout(timer); } }, [commandOpen]);

  useEffect(() => {
    const q = debounced.trim();
    if (!commandOpen || q.length < 2) return;
    const controller = new AbortController();
    data.listDocuments({ brand, q }, controller.signal)
      .then(page => { if (!controller.signal.aborted) { setResults(page.documents.slice(0, 6)); setSearchedFor(q); } })
      .catch(() => { if (!controller.signal.aborted) { setResults([]); setSearchedFor(q); } });
    return () => controller.abort();
  }, [debounced, commandOpen, brand, data]);

  const searching = query.trim().length >= 2 && searchedFor !== query.trim();
  const shownResults = useMemo(() => (query.trim().length >= 2 ? results : []), [query, results]);
  const go = useCallback((path: string) => { close(); router.push(path); }, [close, router]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim();
    const pages: Item[] = ALL_NAV.filter(item => !(item.liveOnly && demo)).map(item => ({
      id: `nav:${item.href}`, group: "Go to", label: item.label, icon: item.icon, keywords: item.keywords,
      run: () => go(item.href.startsWith("/cms") || item.href.startsWith("/admin") ? href(item.href) : item.href),
    }));
    const publications: Item[] = brands.filter(item => item !== brand).map(item => ({
      id: `brand:${item}`, group: "Switch publication", label: BRAND_NAMES[item], icon: Newspaper, dot: brandColor(item), keywords: `${item} publication brand`,
      run: () => { close(); setBrand(item); },
    }));
    const actions: Item[] = [
      { id: "new-article", group: "Create", label: "New article", icon: Plus, keywords: "create story write", run: () => { close(); openCreate("article"); } },
      { id: "new-rating", group: "Create", label: "New rating", icon: Star, keywords: "create review score tasting note", run: () => { close(); openCreate("rating"); } },
      { id: "new-page", group: "Create", label: "New page", icon: FileText, keywords: "create landing standalone", run: () => { close(); openCreate("page"); } },
      { id: "theme", group: "Actions", label: "Switch light or dark theme", icon: SunMoon, keywords: "dark mode light appearance", run: () => { close(); toggleTheme(); } },
    ];
    const documents: Item[] = shownResults.map(row => ({
      id: `doc:${row.id}`, group: "Documents", label: row.title || "Untitled", icon: FileText, dot: brandColor(row.brand),
      detail: `${STATE_LABELS[row.publication_state]} · ${relativeTime(row.updated_at)}`,
      run: () => go(href(`/cms/doc/${row.id}`)),
    }));
    const ranked = [...pages, ...publications, ...actions]
      .map(item => ({ item, score: matchScore(q, `${item.label} ${item.keywords ?? ""}`) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(entry => entry.item);
    return q.length >= 2 ? [...documents, ...ranked] : ranked;
  }, [query, shownResults, brands, brand, demo, href, go, close, setBrand, openCreate, toggleTheme]);

  const [itemsKey, setItemsKey] = useState("");
  const nextItemsKey = `${items.length}:${query}`;
  if (itemsKey !== nextItemsKey) { setItemsKey(nextItemsKey); setActive(0); }
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!commandOpen) return null;
  const groups = items.reduce<{ group: string; items: { item: Item; index: number }[] }[]>((acc, item, index) => {
    const last = acc[acc.length - 1];
    if (last && last.group === item.group) last.items.push({ item, index }); else acc.push({ group: item.group, items: [{ item, index }] });
    return acc;
  }, []);

  return <div className="ed-command-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div ref={layerRef} role="dialog" aria-modal="true" aria-label="Command bar" className="ed-command">
      <div className="ed-command-input">
        <Search size={16} aria-hidden />
        <input ref={inputRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search documents, jump to a page, or run an action…" aria-label="Search" role="combobox" aria-expanded aria-controls="ed-command-list" aria-activedescendant={items[active] ? `ed-command-${items[active].id}` : undefined}
          onKeyDown={event => {
            if (event.key === "ArrowDown") { event.preventDefault(); setActive(value => Math.min(items.length - 1, value + 1)); }
            else if (event.key === "ArrowUp") { event.preventDefault(); setActive(value => Math.max(0, value - 1)); }
            else if (event.key === "Enter" && items[active]) { event.preventDefault(); items[active].run(); }
          }} />
        <kbd>esc</kbd>
      </div>
      <div ref={listRef} id="ed-command-list" role="listbox" className="ed-command-list">
        {groups.map(group => <div key={group.group}>
          <div className="ed-command-group">{group.group}</div>
          {group.items.map(({ item, index }) => <button key={item.id} id={`ed-command-${item.id}`} type="button" role="option" aria-selected={index === active} data-active={index === active} data-index={index} className="ed-command-item" onMouseEnter={() => setActive(index)} onClick={item.run}>
            {item.dot ? <span className="ed-brand-dot" style={{ background: item.dot, width: 8, height: 8 }} aria-hidden /> : createElement(item.icon, { size: 16, strokeWidth: 1.75, "aria-hidden": true })}
            <span>{item.label}</span>
            {item.detail && <small>{item.detail}</small>}
            {index === active && <ArrowRight size={14} aria-hidden style={{ color: "var(--muted-soft)" }} />}
          </button>)}
        </div>)}
        {!items.length && <div className="ed-command-empty">{searching ? "Searching…" : query.trim().length >= 2 ? `No matches for “${query.trim()}” in ${BRAND_NAMES[brand as CmsBrand]}.` : "Type to search."}</div>}
        {searching && items.length > 0 && <div className="ed-command-group">Searching documents…</div>}
      </div>
      <div className="ed-command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd><CornerDownLeft size={10} aria-hidden /></kbd> open</span><span><kbd>⌘K</kbd> toggle</span></div>
    </div>
  </div>;
}
