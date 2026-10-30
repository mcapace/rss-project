"use client";

import { createElement, type ButtonHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Check, Info, Minus, X, type LucideIcon } from "lucide-react";
import { brandColor, BRAND_NAMES, STATE_LABELS, type DocumentTone } from "@/lib/editorial/helpers";
import type { CmsBrand } from "@/lib/cms/types";
import { useLayer } from "./hooks";

/* Buttons ----------------------------------------------------------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "subtle" | "danger"; size?: "sm" | "md" | "lg"; icon?: LucideIcon; ai?: boolean };

export function Button({ variant = "default", size = "md", icon, ai, className = "", children, type = "button", ...rest }: ButtonProps) {
  const classes = ["ed-button", variant !== "default" ? variant : "", size !== "md" ? size : "", ai ? "ai-glow" : "", className].filter(Boolean).join(" ");
  return <button type={type} className={classes} {...rest}>{icon && createElement(icon, { size: size === "sm" ? 14 : 15, strokeWidth: 1.9, "aria-hidden": true })}{children}</button>;
}

export function LinkButton({ href, variant = "default", size = "md", icon, className = "", children, ...rest }: { href: string; variant?: ButtonProps["variant"]; size?: ButtonProps["size"]; icon?: LucideIcon; className?: string; children: ReactNode; target?: string; rel?: string; title?: string }) {
  const classes = ["ed-button", variant !== "default" ? variant : "", size !== "md" ? size : "", className].filter(Boolean).join(" ");
  return <Link href={href} className={classes} {...rest}>{icon && createElement(icon, { size: size === "sm" ? 14 : 15, strokeWidth: 1.9, "aria-hidden": true })}{children}</Link>;
}

export function IconButton({ label, icon, small, className = "", ai, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: LucideIcon; small?: boolean; ai?: boolean }) {
  return <button type="button" aria-label={label} title={label} className={`ed-icon-button ${small ? "small" : ""} ${ai ? "ai-glow" : ""} ${className}`} {...rest}>{createElement(icon, { size: small ? 14 : 16, strokeWidth: 1.75, "aria-hidden": true })}</button>;
}

/* Selection controls ----------------------------------------------- */

export function Segmented<T extends string>({ options, value, onChange, label, size }: { options: { id: T; label: string; count?: number }[]; value: T; onChange: (value: T) => void; label: string; size?: "sm" }) {
  return <div role="group" aria-label={label} className={`ed-segmented ${size ?? ""}`}>
    {options.map((option, index) => <button key={option.id} type="button" aria-pressed={value === option.id} onClick={() => onChange(option.id)}
      onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + options.length) % options.length;
        onChange(options[next].id);
        (event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
      }}>
      {option.label}{option.count != null && <em>{option.count}</em>}
    </button>)}
  </div>;
}

export function Chips<T extends string>({ options, selected, onToggle, label }: { options: { id: T; label: string; dot?: string }[]; selected: readonly T[]; onToggle: (value: T) => void; label: string }) {
  return <div role="group" aria-label={label} className="ed-chips">
    {options.map(option => <button key={option.id} type="button" aria-pressed={selected.includes(option.id)} onClick={() => onToggle(option.id)}>
      {option.dot && <span className="ed-brand-dot" style={{ background: option.dot }} aria-hidden />}{option.label}
    </button>)}
  </div>;
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="ed-switch" onClick={() => onChange(!checked)} />;
}

/* Status ------------------------------------------------------------ */

export function Pill({ tone, children, plain }: { tone?: DocumentTone | "processing" | "failed" | "queued" | string; children?: ReactNode; plain?: boolean }) {
  const label = children ?? (tone && tone in STATE_LABELS ? STATE_LABELS[tone as DocumentTone] : tone);
  return <span className={`ed-pill ${plain ? "plain" : ""}`} data-tone={tone}>{label}</span>;
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="ed-tag">{children}</span>;
}

export function BrandDot({ brand, size = 8 }: { brand: string; size?: number }) {
  return <span className="ed-brand-dot" style={{ background: brandColor(brand), width: size, height: size }} aria-hidden />;
}

export function BrandLabel({ brand }: { brand: CmsBrand }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><BrandDot brand={brand} />{BRAND_NAMES[brand]}</span>;
}

export function Delta({ current, previous, suffix = "" }: { current: number; previous: number; suffix?: string }) {
  if (previous === 0 && current === 0) return <span className="ed-delta" data-tone="flat"><Minus size={12} aria-hidden />No change</span>;
  const diff = current - previous;
  const tone = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const Icon = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;
  return <span className="ed-delta" data-tone={tone}><Icon size={12} aria-hidden />{diff > 0 ? "+" : ""}{diff}{suffix} vs prior week</span>;
}

/* Surfaces ---------------------------------------------------------- */

export function Card({ children, className = "", pad = true, flat, still }: { children: ReactNode; className?: string; pad?: boolean | "sm"; flat?: boolean; still?: boolean }) {
  return <section className={`ed-card ${pad === "sm" ? "pad-sm" : pad ? "pad" : ""} ${flat ? "flat" : ""} ${still ? "still" : ""} ${className}`}>{children}</section>;
}

export function AppIcon({ icon, size }: { icon: LucideIcon; size?: "sm" | "md" | "lg" }) {
  const px = size === "sm" ? 15 : size === "lg" ? 22 : 18;
  return <span className={`ed-app-icon ${size ?? ""}`} aria-hidden>{createElement(icon, { size: px, strokeWidth: 1.75 })}</span>;
}

export function PageHeader({ icon, title, lede, actions, children }: { icon: LucideIcon; title: string; lede?: string; actions?: ReactNode; children?: ReactNode }) {
  return <>
    <div className="ed-page-header">
      <div className="ed-page-identity">
        <AppIcon icon={icon} />
        <div style={{ minWidth: 0 }}>
          <h1>{title}</h1>
          {lede && <p className="ed-lede">{lede}</p>}
        </div>
      </div>
      {actions && <div className="ed-page-actions">{actions}</div>}
    </div>
    {children}
  </>;
}

export function SectionHead({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return <div className="ed-section-head">
    <div style={{ minWidth: 0 }}><h2 className="ed-section-title">{title}</h2>{detail && <p>{detail}</p>}</div>
    {action}
  </div>;
}

export function Notice({ tone, icon: Icon = Info, children }: { tone?: "warning" | "error" | "success"; icon?: LucideIcon; children: ReactNode }) {
  return <div className="ed-notice" data-tone={tone} role={tone === "error" ? "alert" : "status"}><Icon size={15} aria-hidden /><div>{children}</div></div>;
}

export function Empty({ icon, title, text, action }: { icon: LucideIcon; title: string; text?: string; action?: ReactNode }) {
  return <div className="ed-empty"><AppIcon icon={icon} size="lg" /><h3>{title}</h3>{text && <p>{text}</p>}{action}</div>;
}

export function Skeleton({ width = "100%", height = 14, radius, style }: { width?: number | string; height?: number | string; radius?: number; style?: React.CSSProperties }) {
  return <span className="ed-skeleton" style={{ width, height, borderRadius: radius, ...style }} aria-hidden />;
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return <div style={{ display: "grid", gap: 14, padding: "6px 0" }}>{Array.from({ length: rows }, (_, index) => <div key={index} style={{ display: "grid", gridTemplateColumns: "1fr 90px 70px", gap: 16, alignItems: "center" }}><div style={{ display: "grid", gap: 6 }}><Skeleton width={`${55 + (index * 17) % 35}%`} /><Skeleton width={`${30 + (index * 13) % 30}%`} height={10} /></div><Skeleton height={20} radius={99} /><Skeleton width={54} /></div>)}</div>;
}

/* Layers ------------------------------------------------------------ */

export function Dialog({ open, onClose, title, description, children, footer }: { open: boolean; onClose: () => void; title: string; description?: string; children?: ReactNode; footer?: ReactNode }) {
  const ref = useLayer(open, onClose);
  if (!open) return null;
  return <div className="ed-dialog-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="ed-dialog-title" className="ed-dialog">
      <div className="ed-dialog-head"><h2 id="ed-dialog-title">{title}</h2>{description && <p>{description}</p>}</div>
      {children && <div className="ed-dialog-body">{children}</div>}
      {footer && <div className="ed-dialog-foot">{footer}</div>}
    </div>
  </div>;
}

export function SidePanel({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useLayer(open, onClose);
  if (!open) return null;
  return <>
    <div className="ed-panel-scrim" onClick={onClose} aria-hidden />
    <aside ref={ref} role="dialog" aria-modal="true" aria-label={title} className="ed-panel">
      <div className="ed-panel-head"><h2>{title}</h2><IconButton label="Close" icon={X} small onClick={onClose} /></div>
      <div className="ed-panel-body">{children}</div>
      {footer && <div className="ed-panel-foot">{footer}</div>}
    </aside>
  </>;
}

export function Toasts({ toasts, onDismiss }: { toasts: { id: number; message: string; tone: string }[]; onDismiss: (id: number) => void }) {
  if (!toasts.length) return null;
  return <div className="ed-toasts" aria-live="polite">
    {toasts.map(toast => <div key={toast.id} className="ed-toast" data-tone={toast.tone} role="status">
      {toast.tone === "success" && <Check size={15} aria-hidden />}{toast.message}
      <button type="button" aria-label="Dismiss" onClick={() => onDismiss(toast.id)}><X size={14} aria-hidden /></button>
    </div>)}
  </div>;
}

/* Form bits --------------------------------------------------------- */

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return <div className="ed-field"><label htmlFor={htmlFor}>{label}</label>{children}{hint && <small>{hint}</small>}</div>;
}
