"use client";

import { createElement, useCallback, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronDown, ChevronsUpDown, Moon, PanelLeftClose, PanelLeftOpen, Plus, Search, Sun, X } from "lucide-react";
import { BRAND_NAMES, BRAND_SHORT, brandColor } from "@/lib/editorial/helpers";
import { useEditorial } from "./EditorialProvider";
import { useAsync, useDismiss, useTheme } from "./hooks";
import { ARCHIVE_NAV, PRIMARY_NAV, PRINT_NAV, type NavItem } from "./nav";
import { useShell } from "./Shell";

function PublicationSwitcher({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { brand, brands, setBrand, user, demo, href } = useEditorial();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const roleLabel = demo ? "Demo" : user.role === "admin" ? "Administrator" : "Editor";
  if (collapsed) {
    return <Link href={href("/cms")} onClick={onNavigate} aria-label={`${BRAND_NAMES[brand]} home`} title={BRAND_NAMES[brand]} className="ed-switcher-mark" data-brand={brand} style={{ background: brandColor(brand) }}>{BRAND_SHORT[brand]}</Link>;
  }
  return <div ref={ref} className="ed-switcher" style={{ width: "100%" }}>
    <button type="button" className="ed-switcher-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span className="ed-switcher-mark" data-brand={brand} style={{ background: brandColor(brand) }}>{BRAND_SHORT[brand]}</span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span className="ed-switcher-title">{BRAND_NAMES[brand]}</span>
        <span className="ed-switcher-sub">M. Shanken · {roleLabel}</span>
      </span>
      <ChevronsUpDown size={14} style={{ color: "var(--muted)", flexShrink: 0 }} aria-hidden />
    </button>
    {open && <div role="menu" aria-label="Switch publication" className="ed-menu">
      <p className="ed-menu-label">Publications</p>
      {brands.map(item => <button key={item} role="menuitemradio" aria-checked={item === brand} className="ed-menu-item" aria-current={item === brand ? "page" : undefined} onClick={() => { setBrand(item); setOpen(false); onNavigate?.(); }}>
        <span className="ed-brand-dot" style={{ background: brandColor(item) }} aria-hidden /><span style={{ flex: 1 }}>{BRAND_NAMES[item]}</span>{item === brand && <Check size={14} aria-hidden />}
      </button>)}
      {brands.length < 4 && <><div className="ed-menu-sep" /><p className="ed-menu-label" style={{ paddingBottom: 6 }}>Other publications need an administrator grant.</p></>}
    </div>}
  </div>;
}

function NavLink({ item, collapsed, badge, onNavigate }: { item: NavItem; collapsed: boolean; badge?: number; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { href, demo } = useEditorial();
  const active = item.match(pathname);
  const target = item.href.startsWith("/cms") || item.href.startsWith("/admin") ? href(item.href) : item.href;
  return <Link href={target} onClick={onNavigate} data-collapsed={collapsed} title={collapsed ? item.label : undefined} aria-label={collapsed ? item.label : undefined} aria-current={active ? "page" : undefined} className="ed-nav-link">
    {createElement(item.icon, { size: 16, strokeWidth: 1.75, "aria-hidden": true })}
    <span>{item.label}</span>
    {badge != null && badge > 0 && <span className="ed-nav-badge">{badge > 99 ? "99+" : badge}</span>}
    {collapsed && badge != null && badge > 0 && <span className="ed-nav-dot" aria-hidden />}
    {item.liveOnly && demo && <span className="ed-nav-tag">Sign in</span>}
  </Link>;
}

export function Sidebar({ collapsed, onToggleCollapse, onNavigate }: { collapsed: boolean; onToggleCollapse: () => void; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { brand, data, demo, mutationVersion, setCommandOpen } = useEditorial();
  const { openCreate } = useShell();
  const overview = useAsync(`overview:${brand}:${mutationVersion}`, signal => data.overview(brand, signal));
  const { toggle: toggleTheme } = useTheme();
  const visible = (items: NavItem[]) => items.filter(item => !(item.liveOnly && demo));
  const printActive = PRINT_NAV.some(item => item.match(pathname));
  const archiveActive = ARCHIVE_NAV.some(item => item.match(pathname));

  const group = (id: string, label: string, active: boolean, items: NavItem[], icon: NavItem["icon"]) => {
    if (!items.length) return null;
    if (collapsed) return <div key={id}><div className="ed-nav-divider" />{items.map(item => <NavLink key={item.href} item={item} collapsed onNavigate={onNavigate} />)}</div>;
    return <details key={active ? `${id}-active` : id} open={active || undefined} className="ed-nav-group">
      <summary className="ed-nav-link">
        {createElement(icon, { size: 16, strokeWidth: 1.75, "aria-hidden": true })}
        <span>{label}</span>
        <ChevronDown size={14} className="ed-nav-chevron" aria-hidden />
      </summary>
      <div className="ed-nav-group-items">{items.map(item => <NavLink key={item.href} item={item} collapsed={false} onNavigate={onNavigate} />)}</div>
    </details>;
  };

  return <div className="ed-sidebar" data-collapsed={collapsed}>
    <div className="ed-sidebar-brand"><PublicationSwitcher collapsed={collapsed} onNavigate={onNavigate} /></div>
    <div className="ed-sidebar-search">
      {collapsed
        ? <button type="button" className="ed-nav-link" data-collapsed="true" aria-label="Search or jump (⌘K)" title="Search or jump (⌘K)" onClick={() => { onNavigate?.(); setCommandOpen(true); }}><Search size={16} strokeWidth={1.75} aria-hidden /></button>
        : <button type="button" className="ed-command-trigger" aria-label="Search or jump (⌘K)" onClick={() => { onNavigate?.(); setCommandOpen(true); }}><Search size={14} strokeWidth={2} aria-hidden /><span>Search or jump to…</span><kbd>⌘K</kbd></button>}
    </div>
    <nav aria-label="Main navigation">
      <div style={{ display: "grid", gap: 1 }}>
        {PRIMARY_NAV.map(item => <NavLink key={item.href} item={item} collapsed={collapsed} badge={item.badge === "review" ? overview.data?.review ?? undefined : undefined} onNavigate={onNavigate} />)}
        {collapsed
          ? <button type="button" className="ed-nav-link" data-collapsed="true" aria-label="New document" title="New document" onClick={() => { onNavigate?.(); openCreate(); }}><Plus size={16} strokeWidth={1.75} aria-hidden /></button>
          : <button type="button" className="ed-nav-link" onClick={() => { onNavigate?.(); openCreate(); }}><Plus size={16} strokeWidth={1.75} aria-hidden /><span>New document</span><kbd>N</kbd></button>}
      </div>
      {group("print", "Print", printActive, visible(PRINT_NAV), PRINT_NAV[0].icon)}
      {group("archive", "Archive", archiveActive, visible(ARCHIVE_NAV), ARCHIVE_NAV[0].icon)}
    </nav>
    <div className="ed-sidebar-footer">
      <button type="button" onClick={toggleTheme} className="ed-icon-button" aria-label="Switch light or dark theme" title="Switch light or dark theme">
        <Sun size={15} strokeWidth={1.75} className="ed-theme-light" aria-hidden /><Moon size={15} strokeWidth={1.75} className="ed-theme-dark" aria-hidden />
      </button>
      <button type="button" onClick={onToggleCollapse} className="ed-icon-button" style={{ display: onNavigate ? "none" : undefined }} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
        {collapsed ? <PanelLeftOpen size={15} strokeWidth={1.75} aria-hidden /> : <PanelLeftClose size={15} strokeWidth={1.75} aria-hidden />}
      </button>
      {onNavigate && <button type="button" onClick={onNavigate} className="ed-icon-button" style={{ marginLeft: "auto" }} aria-label="Close navigation"><X size={15} aria-hidden /></button>}
    </div>
  </div>;
}
