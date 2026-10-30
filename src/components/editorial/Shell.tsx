"use client";

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGrid, Plus, Sparkles } from "lucide-react";
import type { CmsDocumentKind } from "@/lib/cms/types";
import { CONTENT_TYPE_LABELS } from "@/lib/cms/organization";
import { BRAND_NAMES } from "@/lib/editorial/helpers";
import { useEditorial } from "./EditorialProvider";
import { useLayer, useStoredState } from "./hooks";
import { PRIMARY_NAV } from "./nav";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { CommandPalette } from "./CommandPalette";
import { Button, Dialog, Field, SidePanel, Toasts } from "./ui";
import { Assistant, type AssistantContext } from "./Assistant";

type ShellContextValue = {
  title: string | null;
  setTitle: (title: string | null) => void;
  openCreate: (kind?: CmsDocumentKind) => void;
  /** Pages set this while they hold unsaved work so navigation can warn. */
  setDirty: (dirty: boolean) => void;
  /** Open the assistant panel, optionally sending a first message. */
  openAssistant: (prompt?: string) => void;
  /** A document page registers itself so the assistant can read and change it. */
  setAssistantContext: (context: AssistantContext | null) => void;
};

const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside Shell.");
  return value;
}

/** Sets the breadcrumb title for the current page while mounted. */
export function usePageTitle(title: string | null) {
  const { setTitle } = useShell();
  useEffect(() => { setTitle(title); return () => setTitle(null); }, [title, setTitle]);
}

const CREATE_KINDS: CmsDocumentKind[] = ["article", "rating", "page", "collection_entry", "glossary_entry", "directory_entry", "product_review"];

function CreateDialog({ open, kind, onClose }: { open: boolean; kind: CmsDocumentKind; onClose: () => void }) {
  const router = useRouter();
  const { brand, data, href, toast } = useEditorial();
  const [title, setTitle] = useState("");
  const [selectedKind, setSelectedKind] = useState<CmsDocumentKind>(kind);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) { setError("Give the document a working title."); return; }
    setPending(true); setError("");
    try {
      const document = await data.createDocument({ brand, kind: selectedKind, title: title.trim() });
      toast(`${CONTENT_TYPE_LABELS[selectedKind].singular} created`, "success");
      onClose();
      router.push(href(`/cms/doc/${document.id}`));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The document could not be created.");
    } finally { setPending(false); }
  }
  return <Dialog open={open} onClose={onClose} title="New document" description={`A draft in ${BRAND_NAMES[brand]}. You can change the type and title later.`}
    footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" form="ed-create-form" type="submit" disabled={pending} icon={Plus}>{pending ? "Creating…" : "Create draft"}</Button></>}>
    <form id="ed-create-form" onSubmit={submit} style={{ display: "grid", gap: 14 }}>
      <Field label="Working title" htmlFor="ed-create-title">
        <input id="ed-create-title" className="ed-input" autoFocus value={title} maxLength={500} onChange={event => setTitle(event.target.value)} placeholder="What is the story?" disabled={pending} />
      </Field>
      <Field label="Type" htmlFor="ed-create-kind">
        <select id="ed-create-kind" className="ed-select" value={selectedKind} onChange={event => setSelectedKind(event.target.value as CmsDocumentKind)} disabled={pending}>
          {CREATE_KINDS.map(item => <option key={item} value={item}>{CONTENT_TYPE_LABELS[item].singular}</option>)}
        </select>
      </Field>
      {error && <p role="alert" style={{ color: "var(--negative)", fontSize: 13 }}>{error}</p>}
    </form>
  </Dialog>;
}

function MobileTabBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const pathname = usePathname();
  const { href } = useEditorial();
  return <nav className="ed-tabbar" aria-label="Workspace sections">
    {PRIMARY_NAV.slice(0, 4).map(item => <Link key={item.href} href={href(item.href)} className="ed-tab" aria-current={item.match(pathname) ? "page" : undefined}>
      {createElement(item.icon, { size: 18, strokeWidth: 1.75, "aria-hidden": true })}{item.label.split(" ")[0]}
    </Link>)}
    <button type="button" className="ed-tab" onClick={onOpenMenu}><LayoutGrid size={18} strokeWidth={1.75} aria-hidden />More</button>
  </nav>;
}

export function Shell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { demo, toasts, dismissToast } = useEditorial();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useStoredState<boolean>("editorial-sidebar-collapsed", false, (value): value is boolean => typeof value === "boolean");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const [create, setCreate] = useState<{ open: boolean; kind: CmsDocumentKind; epoch: number }>({ open: false, kind: "article", epoch: 0 });
  const [dirty, setDirty] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantPrompt, setAssistantPrompt] = useState<string | undefined>(undefined);
  const [assistantContext, setAssistantContext] = useState<AssistantContext | null>(null);
  const closeAssistant = useCallback(() => setAssistantOpen(false), []);
  const openAssistant = useCallback((prompt?: string) => { setAssistantPrompt(prompt); setAssistantOpen(true); }, []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const sheetRef = useLayer(mobileOpen, closeMobile);
  const [mobilePath, setMobilePath] = useState(pathname);
  if (mobilePath !== pathname) { setMobilePath(pathname); if (mobileOpen) setMobileOpen(false); }
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "n") { event.preventDefault(); setCreate(current => ({ open: true, kind: "article", epoch: current.epoch + 1 })); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") { event.preventDefault(); setAssistantOpen(value => !value); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const openCreate = useCallback((kind: CmsDocumentKind = "article") => setCreate(current => ({ open: true, kind, epoch: current.epoch + 1 })), []);
  const value = useMemo<ShellContextValue>(() => ({ title, setTitle, openCreate, setDirty, openAssistant, setAssistantContext }), [title, openCreate, openAssistant]);

  return <ShellContext.Provider value={value}>
    <div className="ed ed-shell">
      <aside className="ed-rail" style={{ width: collapsed ? "var(--sidebar-collapsed)" : "var(--sidebar-width)" }}>
        <Sidebar collapsed={collapsed} onToggleCollapse={() => setCollapsed(value => !value)} />
      </aside>
      {mobileOpen && <>
        <div className="ed-scrim" onClick={closeMobile} aria-hidden />
        <div ref={sheetRef} role="dialog" aria-modal="true" aria-label="Workspace navigation" className="ed-sheet">
          <Sidebar collapsed={false} onToggleCollapse={closeMobile} onNavigate={closeMobile} />
        </div>
      </>}
      <div className="ed-stage" inert={mobileOpen}>
        {demo && <div className="ed-banner"><span><strong>Demo workspace.</strong> Sample content only; edits stay in this browser.</span><Link href="/login">Sign in to the connected workspace</Link></div>}
        <TopBar onOpenMenu={() => setMobileOpen(true)} />
        <main id="main-content" tabIndex={-1} className="ed-main" data-wide={wide ? "true" : undefined}>
          <div className="ed-page">{children}</div>
          <div className="ed-mobile-space" />
        </main>
        <MobileTabBar onOpenMenu={() => setMobileOpen(true)} />
      </div>
      <button type="button" className="ed-assistant-launcher ai-glow" onClick={() => openAssistant()} aria-label="Open the assistant (⌘J)" title="Assistant (⌘J)"><Sparkles size={15} strokeWidth={1.75} aria-hidden />Assistant<kbd>⌘J</kbd></button>
      <SidePanel open={assistantOpen} onClose={closeAssistant} title="Assistant">
        <Assistant context={assistantContext} initialPrompt={assistantPrompt} onConsumedPrompt={() => setAssistantPrompt(undefined)} />
      </SidePanel>
      <CommandPalette />
      <CreateDialog key={create.epoch} open={create.open} kind={create.kind} onClose={() => setCreate(current => ({ ...current, open: false }))} />
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  </ShellContext.Provider>;
}
