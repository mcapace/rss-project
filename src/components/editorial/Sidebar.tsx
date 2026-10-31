"use client";

import { createElement, useCallback, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Check, ChevronsUpDown, Moon, PanelLeftClose, PanelLeftOpen, Plus, Search, Sparkles, Sun, X } from "lucide-react";
import { BRAND_NAMES, BRAND_SHORT, brandColor } from "@/lib/editorial/helpers";
import { useEditorial } from "./EditorialProvider";
import { useAsync, useDismiss, useTheme } from "./hooks";
import { NAV_GROUPS, type NavItem } from "./nav";
import { useShell } from "./Shell";

/** Logo heights tuned so the four wordmarks read at a similar visual weight. */
const BRAND_LOGO_HEIGHT: Record<string, number> = { ws: 26, wa: 30, ca: 19, mw: 13 };
const HAS_WHITE: Record<string, boolean> = { ws: true, wa: true, ca: true, mw: false };

export function PublicationLogo({ brand, height, className = "" }: { brand: string; height: number; className?: string }) {
  return <span className={`ed-logo ${className}`} style={{ height }} data-invert-dark={HAS_WHITE[brand] ? undefined : "true"}>
    {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, sized by height */}
    <img className="ed-logo-light" src={`/brands-cms/${brand}.png`} alt={BRAND_NAMES[brand as keyof typeof BRAND_NAMES] ?? brand} style={{ height }} />
    {HAS_WHITE[brand] && /* eslint-disable-next-line @next/next/no-img-element -- static brand asset, sized by height */
      <img className="ed-logo-dark" src={`/brands-cms/${brand}-white.png`} alt="" aria-hidden style={{ height }} />}
  </span>;
}

function PublicationSwitcher({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { brand, brands, setBrand, user, demo, href } = useEditorial();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const roleLabel = demo ? "Demo" : user.role === "admin" ? "Administrator" : "Editor";
  if (collapsed) {
    return <Link href={href("/cms")} onClick={onNavigate} aria-label={`${BRAND_NAMES[brand]} home`} title={BRAND_NAMES[brand]} className="ed-switcher-mark" data-brand={brand} style={{ background: brandColor(brand) }}>{BRAND_SHORT[brand]}</Link>;
  }
  return <div ref={ref} className="ed-switcher">
    <button type="button" className="ed-switcher-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)} title={`${BRAND_NAMES[brand]} · ${roleLabel}. Switch publication`}>
      <span className="ed-brand-dot" style={{ background: brandColor(brand) }} aria-hidden />
      <span className="ed-switcher-title">{BRAND_NAMES[brand]}</span>
      <span className="ed-switcher-sub">{roleLabel === "Administrator" ? "Admin" : roleLabel}</span>
      <ChevronsUpDown size={13} aria-hidden />
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
  const search = useSearchParams();
  const { href, demo } = useEditorial();
  const active = item.match(pathname, search);
  const target = href(item.href);
  return <Link href={target} onClick={onNavigate} data-collapsed={collapsed} title={collapsed ? item.label : undefined} aria-label={collapsed ? item.label : undefined} aria-current={active ? "page" : undefined} className="ed-nav-link">
    {createElement(item.icon, { size: 16, strokeWidth: 1.6, "aria-hidden": true })}
    <span className="label">{item.label}</span>
    {badge != null && badge > 0 && <span className="ed-nav-badge">{badge > 99 ? "99+" : badge}</span>}
    {collapsed && badge != null && badge > 0 && <span className="ed-nav-dot" aria-hidden />}
    {item.liveOnly && demo && <span className="ed-nav-tag">Sign in</span>}
  </Link>;
}

export function Sidebar({ collapsed, onToggleCollapse, onNavigate }: { collapsed: boolean; onToggleCollapse: () => void; onNavigate?: () => void }) {
  const { brand, data, demo, href, mutationVersion, setCommandOpen } = useEditorial();
  const { openCreate, openAssistant } = useShell();
  const overview = useAsync(`overview:${brand}:${mutationVersion}`, signal => data.overview(brand, signal));
  const { toggle: toggleTheme } = useTheme();
  const visible = (items: NavItem[]) => items.filter(item => !(item.liveOnly && demo));

  return <div className="ed-sidebar" data-collapsed={collapsed}>
    <div className="ed-sidebar-brand">
      {collapsed
        ? <PublicationSwitcher collapsed onNavigate={onNavigate} />
        : <><Link href={href("/cms")} onClick={onNavigate} className="ed-brand-logo" aria-label={`${BRAND_NAMES[brand]} desk`}><PublicationLogo brand={brand} height={BRAND_LOGO_HEIGHT[brand]} /></Link>
          <PublicationSwitcher collapsed={false} onNavigate={onNavigate} /></>}
    </div>
    <div className="ed-sidebar-search">
      {collapsed
        ? <button type="button" className="ed-nav-link" data-collapsed="true" aria-label="Search or jump (⌘K)" title="Search or jump (⌘K)" onClick={() => { onNavigate?.(); setCommandOpen(true); }}><Search size={16} strokeWidth={1.75} aria-hidden /></button>
        : <button type="button" className="ed-command-trigger" aria-label="Search or jump (⌘K)" onClick={() => { onNavigate?.(); setCommandOpen(true); }}><Search size={14} strokeWidth={2} aria-hidden /><span>Search or jump to…</span><kbd>⌘K</kbd></button>}
      {collapsed
        ? <button type="button" className="ed-nav-link" data-collapsed="true" aria-label="New document" title="New document (N)" onClick={() => { onNavigate?.(); openCreate(); }}><Plus size={16} strokeWidth={1.75} aria-hidden /></button>
        : <button type="button" className="ed-new-button" onClick={() => { onNavigate?.(); openCreate(); }}><Plus size={15} strokeWidth={2} aria-hidden /><span>New document</span><kbd>N</kbd></button>}
    </div>
    <nav aria-label="Main navigation">
      {NAV_GROUPS.map(group => {
        const items = visible(group.items);
        if (!items.length) return null;
        return <div key={group.id} className="ed-nav-group-flat">
          {group.label && (collapsed ? <div className="ed-nav-divider" /> : <div className="ed-nav-section">{group.label}</div>)}
          {items.map(item => <NavLink key={item.href} item={item} collapsed={collapsed} badge={item.badge === "review" ? overview.data?.review ?? undefined : undefined} onNavigate={onNavigate} />)}
        </div>;
      })}
    </nav>
    <div className="ed-sidebar-footer">
      {collapsed
        ? <button type="button" className="ed-icon-button ai-glow" aria-label="Assistant (⌘J)" title="Assistant (⌘J)" onClick={() => { onNavigate?.(); openAssistant(); }}><Sparkles size={15} strokeWidth={1.75} aria-hidden /></button>
        : <button type="button" className="ed-assistant-row ai-glow" onClick={() => { onNavigate?.(); openAssistant(); }}><Sparkles size={15} strokeWidth={1.75} aria-hidden /><span>Assistant</span><kbd>⌘J</kbd></button>}
      <div className="ed-sidebar-tools">
        <button type="button" onClick={toggleTheme} className="ed-icon-button" aria-label="Switch light or dark theme" title="Switch light or dark theme">
          <Sun size={15} strokeWidth={1.75} className="ed-theme-light" aria-hidden /><Moon size={15} strokeWidth={1.75} className="ed-theme-dark" aria-hidden />
        </button>
        <button type="button" onClick={onToggleCollapse} className="ed-icon-button" style={{ display: onNavigate ? "none" : undefined }} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? <PanelLeftOpen size={15} strokeWidth={1.75} aria-hidden /> : <PanelLeftClose size={15} strokeWidth={1.75} aria-hidden />}
        </button>
        {onNavigate && <button type="button" onClick={onNavigate} className="ed-icon-button" style={{ marginLeft: "auto" }} aria-label="Close navigation"><X size={15} aria-hidden /></button>}
      </div>
    </div>
  </div>;
}
