"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, CalendarDays, ClipboardCheck, FileInput, FileText, House, Layers, PenLine, Play, Plus, Sparkles, Star, type LucideIcon } from "lucide-react";
import type { CmsDocumentKind, CmsPublicationState } from "@/lib/cms/types";
import { CONTENT_TYPE_LABELS, SOURCE_SYSTEM_LABELS } from "@/lib/cms/organization";
import { BRAND_NAMES, formatDate, isWithinDays, relativeTime, sortBy, STATE_LABELS } from "@/lib/editorial/helpers";
import { loadScheduledDocuments } from "@/lib/editorial/scheduling";
import type { DocumentRow, PrintIssue } from "@/lib/editorial/data";
import { useEditorial } from "./EditorialProvider";
import { useAsync } from "./hooks";
import { useShell } from "./Shell";
import { Button, Card, LinkButton, PageHeader, Pill, Skeleton, SkeletonRows } from "./ui";

/**
 * The desk reads like a newsroom, not a report: a one-line brief of the day,
 * the workflow as a pipeline you can see moving, the next three things to
 * do, a seven-day runway of what goes out, and the latest edits.
 */
const KIND_ICON: Partial<Record<CmsDocumentKind, LucideIcon>> = { article: FileText, rating: Star, page: BookOpen, collection_entry: Layers };
const CREATE: CmsDocumentKind[] = ["article", "rating", "page", "collection_entry"];

function greeting(now: Date): string {
  const hour = now.getHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}
function waiting(row: DocumentRow): string { return relativeTime(row.updated_at).replace(" ago", ""); }
function dayKey(iso: string): string { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }

function IssueSteps({ issue }: { issue: PrintIssue }) {
  const index = issue.status === "queued" ? 0 : issue.status === "processing" ? 1 : 3;
  const steps = ["Queued", "Extracting", "In review"];
  return <span className="ed-steps">{steps.map((label, step) => <span key={label} className="ed-step" data-state={step < index ? "done" : step === index ? "active" : "todo"}><i />{label}</span>)}</span>;
}

function StageItem({ row, href, note }: { row: DocumentRow; href: (path: string) => string; note: string }) {
  const Icon = KIND_ICON[row.kind] ?? FileText;
  return <Link href={href(`/cms/doc/${row.id}`)} className="ed-stage-item">
    <Icon size={13} strokeWidth={1.75} aria-hidden />
    <span className="ed-stage-item-title">{row.title || "Untitled"}</span>
    <span className="ed-stage-item-note">{note}</span>
  </Link>;
}

function Stage({ tone, label, count, max, rows, note, href, more, loading, empty }: { tone: CmsPublicationState | "scheduled"; label: string; count: number | undefined; max: number; rows: DocumentRow[]; note: (row: DocumentRow) => string; href: (path: string) => string; more: string; loading: boolean; empty: string }) {
  const width = count ? Math.max(6, Math.round((count / Math.max(1, max)) * 100)) : 0;
  return <section className="ed-stage" data-tone={tone}>
    <header className="ed-stage-head">
      <Link href={more} className="ed-stage-label"><Pill tone={tone} plain>{label}</Pill></Link>
      <strong className="ed-stage-count">{count == null ? <Skeleton width={32} height={18} /> : count.toLocaleString()}</strong>
    </header>
    <div className="ed-stage-bar" aria-hidden><i style={{ width: `${width}%` }} /></div>
    <div className="ed-stage-list">
      {loading && !rows.length ? <SkeletonRows rows={3} /> : rows.length ? rows.map(row => <StageItem key={row.id} row={row} href={href} note={note(row)} />) : <p className="ed-stage-empty">{empty}</p>}
    </div>
    {count != null && count > rows.length && <Link href={more} className="ed-stage-more">{(count - rows.length).toLocaleString()} more<ArrowRight size={12} aria-hidden /></Link>}
  </section>;
}

function NextAction({ icon: Icon, eyebrow, title, detail, action, href }: { icon: LucideIcon; eyebrow: string; title: string; detail?: string; action: string; href: string }) {
  return <div className="ed-next">
    <span className="ed-next-icon"><Icon size={15} strokeWidth={1.75} aria-hidden /></span>
    <div className="ed-next-body">
      <span className="ed-eyebrow">{eyebrow}</span>
      <Link href={href} className="ed-next-title">{title}</Link>
      {detail && <span className="ed-next-detail">{detail}</span>}
    </div>
    <LinkButton href={href} size="sm">{action}</LinkButton>
  </div>;
}

function Panel({ title, action, children, className = "" }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <Card pad={false} className={`still ed-desk-panel ${className}`}>
    <div className="ed-card-head"><h2>{title}</h2>{action}</div>
    {children}
  </Card>;
}

export function HomeDesk() {
  const { brand, data, demo, href, mutationVersion, user } = useEditorial();
  const { openCreate, openAssistant } = useShell();
  const overview = useAsync(`home-overview:${brand}:${mutationVersion}`, signal => data.overview(brand, signal));
  const review = useAsync(`home-review:${brand}:${mutationVersion}`, signal => data.listDocuments({ brand, state: "review" }, signal));
  const drafts = useAsync(`home-drafts:${brand}:${mutationVersion}`, signal => data.listDocuments({ brand, state: "draft" }, signal));
  const recent = useAsync(`home-recent:${brand}:${mutationVersion}`, signal => data.listDocuments({ brand }, signal));
  const published = useAsync(`home-published:${brand}:${mutationVersion}`, signal => data.listDocuments({ brand, state: "published" }, signal));
  const issues = useAsync(`home-issues:${brand}:${mutationVersion}`, signal => data.listIssues(brand, signal));
  const scheduled = useAsync(`home-schedule:${brand}:${mutationVersion}`, signal => loadScheduledDocuments(data, brand, signal, 40));
  const now = useMemo(() => new Date(), []);

  const reviewOldest = useMemo(() => sortBy(review.data?.documents ?? [], "updated_at", "asc"), [review.data]);
  const draftRows = useMemo(() => sortBy(drafts.data?.documents ?? [], "updated_at", "desc"), [drafts.data]);
  const publishedThisWeek = useMemo(() => sortBy((published.data?.documents ?? []).filter(row => isWithinDays(row.published_at, 7, now)), "published_at", "desc"), [published.data, now]);
  const upcoming = useMemo(() => (scheduled.data?.scheduled ?? []).filter(entry => new Date(entry.publishAt) >= now).sort((a, b) => a.publishAt.localeCompare(b.publishAt)), [scheduled.data, now]);
  const upcomingRows = upcoming.map(entry => entry.document as unknown as DocumentRow);
  const publishAt = new Map(upcoming.map(entry => [entry.document.id, entry.publishAt]));
  const activeIssues = (issues.data ?? []).filter(issue => issue.status !== "published");
  const recentRows = recent.data?.documents.slice(0, 8) ?? [];

  const counts = { draft: overview.data?.drafts, review: overview.data?.review, scheduled: scheduled.data ? upcoming.length : undefined, published: published.data ? publishedThisWeek.length : undefined };
  const max = Math.max(1, ...Object.values(counts).map(value => value ?? 0));
  const firstName = demo ? "there" : user.email.split("@")[0].split(/[._-]/)[0].replace(/^\w/, c => c.toUpperCase());
  const brief = overview.data ? [
    `${counts.review === 1 ? "One story waits" : `${(counts.review ?? 0).toLocaleString()} stories wait`} for review${reviewOldest[0] ? `, the oldest ${waiting(reviewOldest[0])}` : ""}.`,
    `${counts.draft === 1 ? "One draft" : `${(counts.draft ?? 0).toLocaleString()} drafts`} in progress, ${counts.scheduled ?? 0} scheduled${counts.published ? `, ${counts.published} published this week` : ""}.`,
    activeIssues.length ? `${activeIssues.length === 1 ? "One print issue is" : `${activeIssues.length} print issues are`} in intake.` : "",
  ].filter(Boolean).join(" ") : null;

  const days = Array.from({ length: 7 }, (_, offset) => { const day = new Date(now); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() + offset); return day; });
  const byDay = new Map<string, typeof upcoming>();
  for (const entry of upcoming) { const key = dayKey(entry.publishAt); byDay.set(key, [...(byDay.get(key) ?? []), entry]); }

  return <div className="ed-stack">
    <PageHeader icon={House} title="Desk" lede={`${BRAND_NAMES[brand]} · ${formatDate(now.toISOString(), { weekday: "long", month: "long", day: "numeric" })}`}
      actions={<>
        {!demo && <LinkButton href={href("/admin/new")} icon={FileInput}>Upload an issue</LinkButton>}
        <Button variant="primary" icon={Plus} onClick={() => openCreate("article")}>New article</Button>
      </>} />

    <section className="ed-brief">
      <div className="ed-brief-copy">
        <p className="ed-brief-greeting">{greeting(now)}, {firstName}.</p>
        {brief ? <p className="ed-brief-text">{brief}</p> : <Skeleton width="60%" height={18} />}
        <p className="ed-brief-meta">{overview.data ? `${overview.data.total.toLocaleString()} documents · ${overview.data.ratings.toLocaleString()} ratings` : ""}</p>
      </div>
      <div className="ed-brief-side">
        <button type="button" className="ed-button ai-glow" onClick={() => openAssistant("What should I work on first today? Look at the review queue, drafts and schedule and give me a short plan.")}><Sparkles size={15} strokeWidth={1.75} aria-hidden />Plan my day</button>
        <div className="ed-create-row" aria-label="Start a new document">
          {CREATE.map(kind => { const Icon = KIND_ICON[kind] ?? FileText; return <button key={kind} type="button" className="ed-create-tile" onClick={() => openCreate(kind)}><Icon size={13} strokeWidth={1.75} aria-hidden />{CONTENT_TYPE_LABELS[kind].singular}</button>; })}
          <button type="button" className="ed-create-tile" onClick={() => openCreate()} aria-label="Other document type"><Plus size={13} strokeWidth={1.75} aria-hidden /></button>
        </div>
      </div>
    </section>

    <div className="ed-pipeline" aria-label="Workflow pipeline">
      <Stage tone="draft" label="Drafts" count={counts.draft} max={max} rows={draftRows.slice(0, 4)} note={row => relativeTime(row.updated_at)} href={href} more={href("/cms/library", { state: "draft" })} loading={drafts.loading} empty="Nothing in progress." />
      <Stage tone="review" label="In review" count={counts.review} max={max} rows={reviewOldest.slice(0, 4)} note={row => `waiting ${waiting(row)}`} href={href} more={href("/cms/review")} loading={review.loading} empty="The queue is clear." />
      <Stage tone="scheduled" label="Scheduled" count={counts.scheduled} max={max} rows={upcomingRows.slice(0, 4)} note={row => formatDate(publishAt.get(row.id), { weekday: "short", month: "short", day: "numeric" })} href={href} more={href("/cms/schedule")} loading={scheduled.loading && !scheduled.data} empty="Nothing on the calendar." />
      <Stage tone="published" label="Published this week" count={counts.published} max={max} rows={publishedThisWeek.slice(0, 4)} note={row => formatDate(row.published_at, { weekday: "short", month: "short", day: "numeric" })} href={href} more={href("/cms/library", { state: "published" })} loading={published.loading && !published.data} empty="Nothing this week." />
    </div>

    <div className="ed-desk-row">
      <Panel title="Up next">
        <div className="ed-next-list">
          {review.loading && !review.data ? <div style={{ padding: 16 }}><SkeletonRows rows={3} /></div> : <>
            {reviewOldest[0] && <NextAction icon={ClipboardCheck} eyebrow={`Oldest in review · waiting ${waiting(reviewOldest[0])}`} title={reviewOldest[0].title || "Untitled"} detail={`${CONTENT_TYPE_LABELS[reviewOldest[0].kind].singular} · ${SOURCE_SYSTEM_LABELS[reviewOldest[0].source_system].short}`} action="Review" href={href(`/cms/doc/${reviewOldest[0].id}`)} />}
            {draftRows[0] && <NextAction icon={PenLine} eyebrow={`Last draft · ${relativeTime(draftRows[0].updated_at)}`} title={draftRows[0].title || "Untitled"} detail={`${CONTENT_TYPE_LABELS[draftRows[0].kind].singular}${draftRows[0].byline ? ` · ${draftRows[0].byline}` : ""}`} action="Resume" href={href(`/cms/doc/${draftRows[0].id}`)} />}
            {upcoming[0] && <NextAction icon={Play} eyebrow={`Goes out ${formatDate(upcoming[0].publishAt, { weekday: "short", month: "short", day: "numeric" })} · ${new Date(upcoming[0].publishAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`} title={upcoming[0].document.title || "Untitled"} action="Check" href={href(`/cms/doc/${upcoming[0].document.id}`)} />}
            {activeIssues[0] && <NextAction icon={FileInput} eyebrow={activeIssues[0].status === "review" ? `Print issue · ${activeIssues[0].articleCount ?? 0} candidates` : "Print issue in extraction"} title={activeIssues[0].issue_label} action={activeIssues[0].status === "review" ? "Open" : "Status"} href={activeIssues[0].status === "review" ? href("/cms/library", { issue: activeIssues[0].id }) : href(`/admin/${activeIssues[0].id}`)} />}
            {!reviewOldest[0] && !draftRows[0] && !upcoming[0] && !activeIssues[0] && <p className="ed-desk-empty">Nothing is waiting on you. Start something above.</p>}
          </>}
        </div>
      </Panel>
      <Panel title="Runway" action={<LinkButton href={href("/cms/schedule")} size="sm" variant="subtle" icon={CalendarDays}>Calendar</LinkButton>} className="ed-desk-runway">
        <div className="ed-runway" role="list">
          {days.map((day, index) => {
            const entries = byDay.get(dayKey(day.toISOString())) ?? [];
            return <div key={day.toISOString()} className="ed-runway-day" data-today={index === 0 || undefined} role="listitem">
              <div className="ed-runway-date"><span>{formatDate(day.toISOString(), { weekday: "short" })}</span><strong>{day.getDate()}</strong></div>
              <div className="ed-runway-items">
                {entries.map(entry => <Link key={entry.document.id} href={href(`/cms/doc/${entry.document.id}`)} className="ed-runway-item" title={entry.document.title}>
                  <time>{new Date(entry.publishAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</time><span>{entry.document.title || "Untitled"}</span>
                </Link>)}
              </div>
            </div>;
          })}
        </div>
        {scheduled.data && !upcoming.length && <p className="ed-runway-empty">Nothing is scheduled for the next seven days. Set a publish time in a document&rsquo;s Publishing panel and it lands here.</p>}
      </Panel>
    </div>

    <div className="ed-desk-row ed-desk-row-wide">
      <Panel title="Recently edited" action={<LinkButton href={href("/cms/library")} size="sm" variant="subtle" icon={ArrowRight}>Library</LinkButton>}>
        {recent.loading && !recent.data ? <div style={{ padding: 16 }}><SkeletonRows rows={5} /></div> : recentRows.length ? <div className="ed-table-wrap"><table className="ed-table ed-recent-table">
          <thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Byline</th><th className="num">Updated</th></tr></thead>
          <tbody>{recentRows.map(row => <tr key={row.id}>
            <td><div className="title-cell"><Link href={href(`/cms/doc/${row.id}`)}>{row.title || "Untitled"}</Link></div></td>
            <td className="muted">{CONTENT_TYPE_LABELS[row.kind].singular}</td>
            <td><Pill tone={row.publication_state}>{STATE_LABELS[row.publication_state]}</Pill></td>
            <td className="muted">{row.byline || "—"}</td>
            <td className="num muted">{relativeTime(row.updated_at)}</td>
          </tr>)}</tbody>
        </table></div> : <p className="ed-desk-empty">No documents yet. Create one or upload a print issue.</p>}
      </Panel>
      <Panel title="Print intake" action={<LinkButton href={href("/cms/print")} size="sm" variant="subtle" icon={ArrowRight}>All issues</LinkButton>}>
        {issues.loading && !issues.data ? <div style={{ padding: 16 }}><SkeletonRows rows={3} /></div> : activeIssues.length ? <table className="ed-table ed-work-table"><tbody>
          {activeIssues.slice(0, 5).map(issue => <tr key={issue.id}>
            <td><div className="title-cell">
              <Link href={issue.status === "review" ? href("/cms/library", { issue: issue.id }) : href(`/admin/${issue.id}`)}>{issue.issue_label}</Link>
              <small>{issue.status === "review" ? `${issue.articleCount ?? 0} candidates · ${relativeTime(issue.created_at)}` : issue.status === "failed" ? issue.error || "The worker failed." : <IssueSteps issue={issue} />}</small>
            </div></td>
            <td style={{ width: 1 }}><Pill tone={issue.status}>{issue.status === "review" ? "Ready" : issue.status === "processing" ? "Processing" : issue.status === "failed" ? "Failed" : "Queued"}</Pill></td>
          </tr>)}
        </tbody></table> : <p className="ed-desk-empty">{demo ? "Sample issues appear here when the demo has print content." : "Upload a production PDF and the worker turns it into review candidates."}</p>}
      </Panel>
    </div>
  </div>;
}
