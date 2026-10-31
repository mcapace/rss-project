"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, CalendarDays, ClipboardCheck, FileInput, FileText, House, Layers, LibraryBig, PenLine, Plus, Star, type LucideIcon } from "lucide-react";
import type { CmsDocumentKind } from "@/lib/cms/types";
import { CONTENT_TYPE_LABELS, SOURCE_SYSTEM_LABELS } from "@/lib/cms/organization";
import { BRAND_NAMES, formatDate, isWithinDays, relativeTime } from "@/lib/editorial/helpers";
import { loadScheduledDocuments } from "@/lib/editorial/scheduling";
import type { DocumentRow, PrintIssue } from "@/lib/editorial/data";
import { useEditorial } from "./EditorialProvider";
import { useAsync } from "./hooks";
import { useShell } from "./Shell";
import { Button, Card, LinkButton, PageHeader, Pill, Skeleton, SkeletonRows } from "./ui";

/**
 * The desk: a work list, not a report. Counts sit in one quiet strip; the
 * rest of the page is tables of what needs a hand next.
 */
function IssueSteps({ issue }: { issue: PrintIssue }) {
  const index = issue.status === "queued" ? 0 : issue.status === "processing" ? 1 : 3;
  const steps = ["Queued", "Extracting", "In review"];
  return <span className="ed-steps">{steps.map((label, step) => <span key={label} className="ed-step" data-state={step < index ? "done" : step === index ? "active" : "todo"}><i />{label}</span>)}</span>;
}

function Panel({ title, count, action, children }: { title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return <Card pad={false} className="still ed-desk-panel">
    <div className="ed-card-head"><h2>{title}{count != null && <span className="count">{count}</span>}</h2>{action}</div>
    {children}
  </Card>;
}

function WorkTable({ rows, loading, empty, href, when, showState = true }: { rows: DocumentRow[] | undefined; loading: boolean; empty: string; href: (path: string) => string; when: (row: DocumentRow) => string; showState?: boolean }) {
  if (loading && !rows) return <div style={{ padding: "8px 16px" }}><SkeletonRows rows={4} /></div>;
  if (!rows?.length) return <p className="ed-desk-empty">{empty}</p>;
  return <table className="ed-table ed-work-table">
    <tbody>
      {rows.map(row => <tr key={row.id}>
        <td><div className="title-cell"><Link href={href(`/cms/doc/${row.id}`)}>{row.title || "Untitled"}</Link><small>{CONTENT_TYPE_LABELS[row.kind].singular} · {SOURCE_SYSTEM_LABELS[row.source_system].short}{row.byline ? ` · ${row.byline}` : ""}</small></div></td>
        {showState && <td style={{ width: 1 }}><Pill tone={row.publication_state} /></td>}
        <td className="num muted" style={{ width: 1 }}>{when(row)}</td>
      </tr>)}
    </tbody>
  </table>;
}

const CREATE: { kind: CmsDocumentKind; icon: LucideIcon }[] = [
  { kind: "article", icon: FileText }, { kind: "rating", icon: Star }, { kind: "page", icon: BookOpen }, { kind: "collection_entry", icon: Layers },
];

export function HomeDesk() {
  const { brand, data, demo, href, mutationVersion } = useEditorial();
  const { openCreate } = useShell();
  const overview = useAsync(`home-overview:${brand}:${mutationVersion}`, signal => data.overview(brand, signal));
  const review = useAsync(`home-review:${brand}:${mutationVersion}`, signal => data.listDocuments({ brand, state: "review" }, signal));
  const drafts = useAsync(`home-drafts:${brand}:${mutationVersion}`, signal => data.listDocuments({ brand, state: "draft" }, signal));
  const recent = useAsync(`home-recent:${brand}:${mutationVersion}`, signal => data.listDocuments({ brand }, signal));
  const published = useAsync(`home-published:${brand}:${mutationVersion}`, signal => data.listDocuments({ brand, state: "published" }, signal));
  const issues = useAsync(`home-issues:${brand}:${mutationVersion}`, signal => data.listIssues(brand, signal));
  const scheduled = useAsync(`home-schedule:${brand}:${mutationVersion}`, signal => loadScheduledDocuments(data, brand, signal, 40));
  const now = useMemo(() => new Date(), []);
  const publishedThisWeek = (published.data?.documents ?? []).filter(row => isWithinDays(row.published_at, 7, now));
  const upcoming = (scheduled.data?.scheduled ?? []).filter(entry => new Date(entry.publishAt) >= now);
  const activeIssues = (issues.data ?? []).filter(issue => issue.status !== "published").slice(0, 4);
  const publishAt = new Map(upcoming.map(entry => [entry.document.id, entry.publishAt]));

  const stats: { label: string; value: number | undefined; href: string; icon: LucideIcon }[] = [
    { label: "All content", value: overview.data?.total, href: href("/cms/library"), icon: LibraryBig },
    { label: "Needs review", value: overview.data?.review, href: href("/cms/review"), icon: ClipboardCheck },
    { label: "Drafts", value: overview.data?.drafts, href: href("/cms/library", { state: "draft" }), icon: PenLine },
    { label: "Scheduled", value: scheduled.data ? upcoming.length : undefined, href: href("/cms/schedule"), icon: CalendarDays },
    { label: "Published this week", value: published.data ? publishedThisWeek.length : undefined, href: href("/cms/library", { state: "published" }), icon: FileText },
    { label: "Ratings", value: overview.data?.ratings, href: href("/cms/library", { kind: "rating" }), icon: Star },
  ];

  return <div className="ed-stack">
    <PageHeader icon={House} title="Desk" lede={`${BRAND_NAMES[brand]} · ${formatDate(now.toISOString(), { weekday: "long", month: "long", day: "numeric" })}`}
      actions={<>
        {!demo && <LinkButton href={href("/admin/new")} icon={FileInput}>Upload an issue</LinkButton>}
        <Button variant="primary" icon={Plus} onClick={() => openCreate("article")}>New article</Button>
      </>} />

    <div className="ed-desk-strip" role="list">
      {stats.map(stat => <Link key={stat.label} href={stat.href} className="ed-desk-stat" role="listitem">
        <stat.icon size={14} strokeWidth={1.75} aria-hidden />
        <span>{stat.label}</span>
        <strong>{stat.value == null ? <Skeleton width={28} height={16} /> : stat.value.toLocaleString()}</strong>
      </Link>)}
    </div>

    <div className="ed-create-row" aria-label="Start a new document">
      <span className="ed-eyebrow">Start</span>
      {CREATE.map(item => <button key={item.kind} type="button" className="ed-create-tile" onClick={() => openCreate(item.kind)}><item.icon size={14} strokeWidth={1.75} aria-hidden />{CONTENT_TYPE_LABELS[item.kind].singular}</button>)}
      <button type="button" className="ed-create-tile" onClick={() => openCreate()}><Plus size={14} strokeWidth={1.75} aria-hidden />Other type…</button>
    </div>

    <div className="ed-desk-grid">
      <div className="ed-desk-col">
        <Panel title="Needs review" count={review.data?.total} action={<LinkButton href={href("/cms/review")} size="sm" variant="subtle" icon={ArrowRight}>Open queue</LinkButton>}>
          <WorkTable rows={review.data?.documents.slice(0, 7)} loading={review.loading} empty="Nothing is waiting for review." href={href} showState={false} when={row => `waiting ${relativeTime(row.updated_at).replace(" ago", "")}`} />
        </Panel>
        <Panel title="Print intake" count={issues.data ? activeIssues.length : undefined} action={<LinkButton href={href("/cms/print")} size="sm" variant="subtle" icon={ArrowRight}>All issues</LinkButton>}>
          {issues.loading && !issues.data ? <div style={{ padding: "8px 16px" }}><SkeletonRows rows={3} /></div> : activeIssues.length ? <table className="ed-table ed-work-table"><tbody>
            {activeIssues.map(issue => <tr key={issue.id}>
              <td><div className="title-cell">
                <Link href={issue.status === "review" ? href("/cms/library", { issue: issue.id }) : href(`/admin/${issue.id}`)}>{issue.issue_label}</Link>
                <small>{issue.status === "review" ? `${issue.articleCount ?? 0} candidates in the library · ${relativeTime(issue.created_at)}` : issue.status === "failed" ? issue.error || "The worker failed." : <IssueSteps issue={issue} />}</small>
              </div></td>
              <td style={{ width: 1 }}><Pill tone={issue.status}>{issue.status === "review" ? "Ready to review" : issue.status === "processing" ? "Processing" : issue.status === "failed" ? "Failed" : "Queued"}</Pill></td>
            </tr>)}
          </tbody></table> : <p className="ed-desk-empty">{demo ? "Sample issues appear here when the demo has print content." : "Upload a production PDF and the worker turns it into review candidates."}</p>}
        </Panel>
      </div>
      <div className="ed-desk-col">
        <Panel title="In progress" count={drafts.data?.total} action={<LinkButton href={href("/cms/library", { state: "draft" })} size="sm" variant="subtle" icon={ArrowRight}>All drafts</LinkButton>}>
          <WorkTable rows={drafts.data?.documents.slice(0, 7)} loading={drafts.loading} empty="No drafts. Start one above." href={href} showState={false} when={row => relativeTime(row.updated_at)} />
        </Panel>
        <Panel title="Recently edited" action={<LinkButton href={href("/cms/library")} size="sm" variant="subtle" icon={ArrowRight}>Library</LinkButton>}>
          <WorkTable rows={recent.data?.documents.slice(0, 7)} loading={recent.loading} empty="No documents yet. Create one or upload a print issue." href={href} when={row => relativeTime(row.updated_at)} />
        </Panel>
      </div>
      <div className="ed-desk-col">
        <Panel title="Scheduled" count={scheduled.data ? upcoming.length : undefined} action={<LinkButton href={href("/cms/schedule")} size="sm" variant="subtle" icon={CalendarDays}>Calendar</LinkButton>}>
          <WorkTable rows={upcoming.slice(0, 6).map(entry => entry.document)} loading={scheduled.loading && !scheduled.data} empty="Nothing scheduled. Set a publish time in a document's Publishing panel." href={href} showState={false}
            when={row => { const at = publishAt.get(row.id); return at ? `${formatDate(at, { weekday: "short", month: "short", day: "numeric" })} · ${new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""; }} />
        </Panel>
        <Panel title="Published this week" count={published.data ? publishedThisWeek.length : undefined} action={<LinkButton href={href("/cms/library", { state: "published" })} size="sm" variant="subtle" icon={ArrowRight}>All published</LinkButton>}>
          <WorkTable rows={publishedThisWeek.slice(0, 7)} loading={published.loading && !published.data} empty="Nothing published in the last seven days. Imported records keep their original dates." href={href} showState={false} when={row => formatDate(row.published_at, { weekday: "short", month: "short", day: "numeric" })} />
        </Panel>
      </div>
    </div>
  </div>;
}
