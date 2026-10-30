import type { CmsBrand, CmsDocument, CmsJsonObject, CmsPublicationState } from "@/lib/cms/types";
import { CMS_BRANDS } from "@/lib/cms/types";

/* ------------------------------------------------------------------ */
/* Links                                                              */
/* ------------------------------------------------------------------ */

export type LinkContext = { brand?: CmsBrand | null; demo?: boolean };

/** Build a workspace link that carries the selected publication and demo mode. */
export function workspaceHref(path: string, context: LinkContext = {}, extra: Record<string, string | null | undefined> = {}): string {
  const [pathname, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  if (context.brand) params.set("brand", context.brand); else params.delete("brand");
  if (context.demo) params.set("demo", "1"); else params.delete("demo");
  for (const [key, value] of Object.entries(extra)) {
    if (value == null || value === "") params.delete(key); else params.set(key, value);
  }
  const search = params.toString();
  return search ? `${pathname}?${search}` : pathname;
}

/* ------------------------------------------------------------------ */
/* Dates                                                              */
/* ------------------------------------------------------------------ */

const DAY = 86_400_000;

export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = now.getTime() - then;
  const abs = Math.abs(diff);
  const future = diff < 0;
  const unit = (value: number, label: string) => `${value} ${label}${value === 1 ? "" : "s"}`;
  let text: string;
  if (abs < 45_000) return future ? "in a moment" : "just now";
  if (abs < 3_600_000) text = unit(Math.round(abs / 60_000), "minute");
  else if (abs < DAY) text = unit(Math.round(abs / 3_600_000), "hour");
  else if (abs < 30 * DAY) text = unit(Math.round(abs / DAY), "day");
  else if (abs < 365 * DAY) text = unit(Math.round(abs / (30 * DAY)), "month");
  else text = unit(Math.round(abs / (365 * DAY)), "year");
  return future ? `in ${text}` : `${text} ago`;
}

export function formatDate(iso: string | null | undefined, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", options);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}, ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

/** The local calendar day for a timestamp, as YYYY-MM-DD. */
export function dayKey(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function daysAgo(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - days * DAY);
}

export function isWithinDays(iso: string | null | undefined, days: number, now: Date = new Date()): boolean {
  if (!iso) return false;
  const time = new Date(iso).getTime();
  return !Number.isNaN(time) && now.getTime() - time <= days * DAY && time <= now.getTime();
}

/** Convert a local datetime-local input value to an ISO instant, or null. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Convert an ISO instant to the value a datetime-local input expects. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export type CalendarCell = { key: string; date: Date; day: number; outside: boolean; today: boolean };

/** Six rows of seven days covering a month, Sunday first. */
export function monthGrid(year: number, month: number, today: Date = new Date()): CalendarCell[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const todayKey = dayKey(today);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const key = dayKey(date);
    return { key, date, day: date.getDate(), outside: date.getMonth() !== month, today: key === todayKey };
  });
}

export function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/* ------------------------------------------------------------------ */
/* Text                                                               */
/* ------------------------------------------------------------------ */

export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr|figcaption)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export function wordCount(html: string | null | undefined): number {
  const text = stripHtml(html);
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

/** Minutes to read at a comfortable magazine pace. */
export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 230));
}

export function initials(nameOrEmail: string | null | undefined): string {
  if (!nameOrEmail) return "?";
  const local = nameOrEmail.split("@")[0];
  const parts = local.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : local.slice(0, 2);
  return letters.toUpperCase();
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Slug from a title: lowercase, hyphenated, ASCII. */
export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

/* ------------------------------------------------------------------ */
/* Diff                                                               */
/* ------------------------------------------------------------------ */

export type DiffSegment = { type: "equal" | "insert" | "delete"; text: string };

function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

/**
 * Word-level diff of two plain-text strings. Uses an LCS table, bounded so a
 * very long article falls back to a paragraph-level comparison.
 */
export function textDiff(before: string, after: string): DiffSegment[] {
  let a = tokenize(before);
  let b = tokenize(after);
  if (a.length * b.length > 4_000_000) {
    a = before.split(/\n+/).map(line => `${line}\n`);
    b = after.split(/\n+/).map(line => `${line}\n`);
  }
  const rows = a.length + 1, cols = b.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * cols + j] = a[i] === b[j] ? table[(i + 1) * cols + j + 1] + 1 : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }
  const out: DiffSegment[] = [];
  const push = (type: DiffSegment["type"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text; else out.push({ type, text });
  };
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { push("equal", a[i]); i++; j++; }
    else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) { push("delete", a[i]); i++; }
    else { push("insert", b[j]); j++; }
  }
  while (i < a.length) push("delete", a[i++]);
  while (j < b.length) push("insert", b[j++]);
  return out;
}

export function diffSummary(segments: DiffSegment[]): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const segment of segments) {
    const words = segment.text.split(/\s+/).filter(Boolean).length;
    if (segment.type === "insert") added += words;
    if (segment.type === "delete") removed += words;
  }
  return { added, removed };
}

/* ------------------------------------------------------------------ */
/* Documents                                                          */
/* ------------------------------------------------------------------ */

export type Schedule = { publish_at: string; note?: string };

/** A planned publish time, stored in metadata.schedule.publish_at. */
export function scheduleOf(metadata: CmsJsonObject | null | undefined): Schedule | null {
  const schedule = metadata?.schedule;
  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) return null;
  const publishAt = (schedule as CmsJsonObject).publish_at;
  if (typeof publishAt !== "string" || Number.isNaN(new Date(publishAt).getTime())) return null;
  const note = (schedule as CmsJsonObject).note;
  return { publish_at: publishAt, ...(typeof note === "string" && note ? { note } : {}) };
}

export function withSchedule(metadata: CmsJsonObject, schedule: Schedule | null): CmsJsonObject {
  const next = { ...metadata };
  if (schedule) next.schedule = { publish_at: schedule.publish_at, ...(schedule.note ? { note: schedule.note } : {}) };
  else delete next.schedule;
  return next;
}

export type DocumentTone = CmsPublicationState | "scheduled";

export function documentTone(doc: Pick<CmsDocument, "publication_state"> & { metadata?: CmsJsonObject | null }): DocumentTone {
  if (doc.publication_state !== "published" && scheduleOf(doc.metadata)) return "scheduled";
  return doc.publication_state;
}

export const STATE_LABELS: Record<DocumentTone, string> = {
  draft: "Draft",
  review: "Needs review",
  published: "Published",
  unpublished: "Unpublished",
  scheduled: "Scheduled",
};

export function sectionOf(metadata: CmsJsonObject | null | undefined): string {
  const section = metadata?.section;
  if (typeof section === "string" && section.trim()) return section.trim();
  const categories = metadata?.categories;
  if (Array.isArray(categories) && typeof categories[0] === "string") return categories[0];
  return "";
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/* ------------------------------------------------------------------ */
/* Brands                                                             */
/* ------------------------------------------------------------------ */

export const BRAND_NAMES: Record<CmsBrand, string> = { wa: "Whisky Advocate", ws: "Wine Spectator", ca: "Cigar Aficionado", mw: "Market Watch" };
export const BRAND_SHORT: Record<CmsBrand, string> = { wa: "WA", ws: "WS", ca: "CA", mw: "MW" };

export function brandColor(brand: string): string {
  return CMS_BRANDS.includes(brand as CmsBrand) ? `var(--brand-${brand})` : "var(--muted)";
}

/* ------------------------------------------------------------------ */
/* Saved views                                                        */
/* ------------------------------------------------------------------ */

export type LibraryFilters = { kind: string; state: string; q: string; sort: string; dir: "asc" | "desc" };
export type SavedView = { id: string; name: string; filters: LibraryFilters; createdAt: string };

export const SAVED_VIEWS_KEY = "editorial-library-views-v1";

export function parseSavedViews(raw: string | null): SavedView[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((view): view is SavedView =>
      !!view && typeof view === "object" && typeof (view as SavedView).id === "string" && typeof (view as SavedView).name === "string" && !!(view as SavedView).filters);
  } catch {
    return [];
  }
}

export function addSavedView(views: SavedView[], name: string, filters: LibraryFilters, now: Date = new Date()): SavedView[] {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) return views;
  const id = `${slugify(trimmed) || "view"}-${now.getTime().toString(36)}`;
  return [...views.filter(view => view.name.toLowerCase() !== trimmed.toLowerCase()), { id, name: trimmed, filters, createdAt: now.toISOString() }];
}

/* ------------------------------------------------------------------ */
/* Search ranking for the command bar                                  */
/* ------------------------------------------------------------------ */

/** 0 when no match; higher is better. Prefix and word-start matches win. */
export function matchScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const haystack = text.toLowerCase();
  if (haystack === q) return 100;
  if (haystack.startsWith(q)) return 80;
  const wordStart = haystack.split(/\s+/).some(word => word.startsWith(q));
  if (wordStart) return 60;
  if (haystack.includes(q)) return 40;
  // Every query word must appear somewhere.
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every(word => haystack.includes(word))) return 25;
  return 0;
}

/* ------------------------------------------------------------------ */
/* Sorting                                                            */
/* ------------------------------------------------------------------ */

export function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "en", { sensitivity: "base", numeric: true });
}

export function sortBy<T>(rows: T[], key: keyof T, dir: "asc" | "desc"): T[] {
  const sorted = [...rows].sort((a, b) => compareValues(a[key], b[key]));
  return dir === "asc" ? sorted : sorted.reverse();
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
