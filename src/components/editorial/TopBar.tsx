"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRight, LogOut, Menu, Monitor, Moon, RefreshCw, Search, Sparkles, Sun } from "lucide-react";
import { initials } from "@/lib/editorial/helpers";
import { useEditorial } from "./EditorialProvider";
import { useDismiss, useTheme } from "./hooks";
import { sectionFor } from "./nav";
import { useShell } from "./Shell";

function UserMenu() {
  const { user, demo, data, toast, href } = useEditorial();
  const { preference, choose } = useTheme();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  async function signOut() {
    try { await data.signOut(); router.push("/login"); router.refresh(); }
    catch (error) { toast(error instanceof Error ? error.message : "Sign-out failed.", "error"); }
  }
  return <div ref={ref} style={{ position: "relative" }}>
    <button type="button" className="ed-icon-button" aria-haspopup="menu" aria-expanded={open} aria-label="Account menu" onClick={() => setOpen(value => !value)}>
      <span className="ed-avatar">{initials(user.email)}</span>
    </button>
    {open && <div role="menu" aria-label="Account" className="ed-menu" data-align="right" style={{ minWidth: 240 }}>
      <div style={{ padding: "8px 8px 6px" }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{user.email}</div>
        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{demo ? "Demo workspace · sample content" : user.role === "admin" ? "Administrator" : "Editor"}</div>
      </div>
      <div className="ed-menu-sep" />
      <p className="ed-menu-label">Appearance</p>
      {([["system", "System", Monitor], ["light", "Light", Sun], ["dark", "Dark", Moon]] as const).map(([id, label, Icon]) =>
        <button key={id} role="menuitemradio" aria-checked={preference === id} className="ed-menu-item" data-active={preference === id} onClick={() => choose(id)}><Icon size={15} aria-hidden /><span style={{ flex: 1 }}>{label}</span></button>)}
      <div className="ed-menu-sep" />
      {demo
        ? <Link role="menuitem" className="ed-menu-item" href="/login"><LogOut size={15} aria-hidden /><span>Sign in to the connected workspace</span></Link>
        : <><Link role="menuitem" className="ed-menu-item" href={href("/cms", { demo: "1" })}><Sparkles size={15} aria-hidden /><span>Open the demo workspace</span></Link>
          <button role="menuitem" className="ed-menu-item" onClick={signOut}><LogOut size={15} aria-hidden /><span>Sign out</span></button></>}
    </div>}
  </div>;
}

export function TopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const pathname = usePathname();
  const { href, demo, refresh, setCommandOpen } = useEditorial();
  const { title } = useShell();
  const section = sectionFor(pathname);
  const atSection = section.href === pathname;
  const [spinning, setSpinning] = useState(false);
  return <div className="ed-topbar">
    <button type="button" className="ed-icon-button ed-menu-button" aria-label="Open navigation" onClick={onOpenMenu}><Menu size={17} strokeWidth={1.75} aria-hidden /></button>
    <nav aria-label="Workspace breadcrumb" className="ed-breadcrumb">
      <Link href={href("/cms")}>Workspace</Link>
      <ChevronRight size={13} aria-hidden />
      {atSection && !title ? <span aria-current="page">{section.label}</span> : <Link href={href(section.href)}>{section.label}</Link>}
      {(title || !atSection) && <><ChevronRight size={13} aria-hidden /><span aria-current="page">{title || "Document"}</span></>}
    </nav>
    <div className="ed-topbar-search">
      <button type="button" className="ed-command-trigger" aria-label="Search or jump (⌘K)" onClick={() => setCommandOpen(true)}><Search size={14} strokeWidth={2} aria-hidden /><span>Search documents, pages, actions…</span><kbd>⌘K</kbd></button>
    </div>
    <div className="ed-topbar-tools">
      {demo && <span className="ed-version" title="Sample content kept in this browser">demo</span>}
      <button type="button" className="ed-icon-button" aria-label="Refresh" title="Refresh" onClick={() => { setSpinning(true); refresh(); setTimeout(() => setSpinning(false), 600); }}><RefreshCw size={15} strokeWidth={1.75} aria-hidden style={{ transition: "transform 600ms", transform: spinning ? "rotate(360deg)" : "none" }} /></button>
      <UserMenu />
    </div>
  </div>;
}
