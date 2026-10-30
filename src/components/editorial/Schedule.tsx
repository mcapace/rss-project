"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { CONTENT_TYPE_LABELS } from "@/lib/cms/organization";
import { dayKey, formatDate, formatDateTime, monthGrid, monthLabel } from "@/lib/editorial/helpers";
import { loadScheduledDocuments } from "@/lib/editorial/scheduling";
import { useEditorial } from "./EditorialProvider";
import { useAsync } from "./hooks";
import { Button, Card, Empty, Notice, PageHeader, Pill, Segmented, SkeletonRows } from "./ui";

type Entry = { id: string; title: string; kind: string; at: string; tone: "published" | "scheduled"; byline: string };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function Schedule({ initialMonth }: { initialMonth?: string }) {
  const { brand, data, href, mutationVersion } = useEditorial();
  const today = useMemo(() => new Date(), []);
  const parsed = /^(\d{4})-(\d{2})$/.exec(initialMonth || "");
  const [year, setYear] = useState(parsed ? Number(parsed[1]) : today.getFullYear());
  const [month, setMonth] = useState(parsed ? Number(parsed[2]) - 1 : today.getMonth());
  const [view, setView] = useState<"month" | "list">("month");
  useEffect(() => {
    const url = new URL(window.location.href);
    const key = `${year}-${String(month + 1).padStart(2, "0")}`;
    if (key === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`) url.searchParams.delete("month"); else url.searchParams.set("month", key);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [year, month, today]);

  const published = useAsync(`schedule-published:${brand}:${mutationVersion}`, async signal => {
    const first = await data.listDocuments({ brand, state: "published" }, signal);
    const second = first.total > first.pageSize ? await data.listDocuments({ brand, state: "published", page: 2 }, signal) : null;
    return { rows: [...first.documents, ...(second?.documents ?? [])], total: first.total };
  });
  const scheduled = useAsync(`schedule-planned:${brand}:${mutationVersion}`, signal => loadScheduledDocuments(data, brand, signal));

  const entries = useMemo<Entry[]>(() => [
    ...(published.data?.rows ?? []).filter(row => row.published_at).map(row => ({ id: row.id, title: row.title, kind: row.kind, at: row.published_at as string, tone: "published" as const, byline: row.byline })),
    ...(scheduled.data?.scheduled ?? []).map(({ document, publishAt }) => ({ id: document.id, title: document.title, kind: document.kind, at: publishAt, tone: "scheduled" as const, byline: document.byline })),
  ].sort((a, b) => a.at.localeCompare(b.at)), [published.data, scheduled.data]);
  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const entry of entries) { const key = dayKey(entry.at); map.set(key, [...(map.get(key) ?? []), entry]); }
    return map;
  }, [entries]);
  const cells = useMemo(() => monthGrid(year, month, today), [year, month, today]);
  const upcoming = entries.filter(entry => entry.tone === "scheduled" && new Date(entry.at) >= today);
  const monthEntries = entries.filter(entry => { const date = new Date(entry.at); return date.getFullYear() === year && date.getMonth() === month; });
  const loading = (published.loading && !published.data) || (scheduled.loading && !scheduled.data);
  const move = (delta: number) => { const next = new Date(year, month + delta, 1); setYear(next.getFullYear()); setMonth(next.getMonth()); };

  return <>
    <PageHeader icon={CalendarDays} title="Schedule" lede="Published stories by their publication date, and drafts with a planned publish time."
      actions={<Segmented label="View" value={view} onChange={setView} options={[{ id: "month", label: "Month" }, { id: "list", label: "Upcoming" }]} />}>
      <div className="ed-toolbar">
        <Button size="sm" icon={ChevronLeft} aria-label="Previous month" onClick={() => move(-1)} />
        <strong style={{ fontSize: 15, minWidth: 160, textAlign: "center" }}>{monthLabel(year, month)}</strong>
        <Button size="sm" aria-label="Next month" onClick={() => move(1)}><ChevronRight size={14} aria-hidden /></Button>
        <Button size="sm" variant="subtle" onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); }}>Today</Button>
        <span className="spacer" />
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{monthEntries.filter(entry => entry.tone === "published").length} published · {monthEntries.filter(entry => entry.tone === "scheduled").length} planned this month</span>
      </div>
    </PageHeader>

    {(published.error || scheduled.error) && <div style={{ marginBottom: 16 }}><Notice tone="error">{published.error || scheduled.error}</Notice></div>}
    {scheduled.data?.truncated && <div style={{ marginBottom: 16 }}><Notice>Planned times come from the {scheduled.data.scanned} most recently edited drafts and review items. Older drafts with a planned time are not shown here.</Notice></div>}
    {published.data && published.data.total > published.data.rows.length && <div style={{ marginBottom: 16 }}><Notice>Showing the {published.data.rows.length} most recently updated published items of {published.data.total}.</Notice></div>}

    {view === "month" ? <Card pad={false} className="still">
      {loading ? <div style={{ padding: 20 }}><SkeletonRows rows={6} /></div> : <div className="ed-calendar" role="grid" aria-label={monthLabel(year, month)}>
        {WEEKDAYS.map(day => <div key={day} role="columnheader" className="ed-calendar-head">{day}</div>)}
        {cells.map(cell => {
          const items = byDay.get(cell.key) ?? [];
          return <div key={cell.key} role="gridcell" className="ed-calendar-day" data-outside={cell.outside} data-today={cell.today}>
            <span className="ed-calendar-date">{cell.day}</span>
            <div className="ed-calendar-items">
              {items.slice(0, 3).map(entry => <Link key={`${entry.id}:${entry.at}`} href={href(`/cms/doc/${entry.id}`)} className="ed-calendar-item" data-tone={entry.tone} title={`${entry.title} · ${formatDateTime(entry.at)}`}>
                <span className="ed-brand-dot" style={{ background: entry.tone === "scheduled" ? "var(--accent)" : "var(--positive)" }} aria-hidden /><span className="text">{entry.title}</span>
              </Link>)}
              {items.length > 3 && <span className="ed-calendar-more">+{items.length - 3} more</span>}
            </div>
          </div>;
        })}
      </div>}
    </Card> : <Card>
      {loading ? <SkeletonRows rows={5} /> : upcoming.length ? <div className="ed-list">
        {upcoming.map(entry => <div key={entry.id} className="ed-row">
          <Clock size={15} style={{ color: "var(--muted)" }} aria-hidden />
          <div className="grow"><Link className="title" href={href(`/cms/doc/${entry.id}`)}>{entry.title}</Link><span className="meta">{CONTENT_TYPE_LABELS[entry.kind as keyof typeof CONTENT_TYPE_LABELS]?.singular ?? entry.kind}{entry.byline ? ` · ${entry.byline}` : ""} · {formatDate(entry.at, { weekday: "long", month: "long", day: "numeric" })} at {new Date(entry.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span></div>
          <Pill tone="scheduled" />
        </div>)}
      </div> : <Empty icon={CalendarDays} title="Nothing planned" text="Set a planned publish time in a document's Publishing panel to see it here." />}
    </Card>}
  </>;
}
