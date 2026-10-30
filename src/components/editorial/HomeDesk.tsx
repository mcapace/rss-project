"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, CalendarDays, ClipboardCheck, FileInput, FileText, House, LibraryBig, PenLine, Plus, Star } from "lucide-react";
import { CONTENT_TYPE_LABELS, SOURCE_SYSTEM_LABELS } from "@/lib/cms/organization";
import { BRAND_NAMES, formatDate, isWithinDays, relativeTime } from "@/lib/editorial/helpers";
import { loadScheduledDocuments } from "@/lib/editorial/scheduling";
import type { DocumentRow, PrintIssue } from "@/lib/editorial/data";
import { useEditorial } from "./EditorialProvider";
import { useAsync } from "./hooks";
import { useShell } from "./Shell";
import { Button, Card, Empty, LinkButton, Pill, SectionHead, Skeleton, SkeletonRows } from "./ui";

function greeting(now: Date): string {
  const hour = now.getHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function DocumentList({ rows, loading, empty, href, showState }: { rows: DocumentRow[] | undefined; loading: boolean; empty: string; href: (path: string) => string; showState?: boolean }) {
  if (loading && !rows) return <SkeletonRows rows={5} />;
  if (!rows?.length) return <p style={{ color: "var(--muted)", fontSize: 13 }}>{empty}</p>;
  return <div className="ed-list">
    {rows.map(row => <div key={row.id} className="ed-row">
      <div className="grow">
        <Link className="title" href={href(`/cms/doc/${row.id}`)}>{row.title || "Untitled"}</Link>
        <span className="meta">{CONTENT_TYPE_LABELS[row.kind].singular} · {SOURCE_SYSTEM_LABELS[row.source_system].short}{row.byline ? ` · ${row.byline}` : ""} · {relativeTime(row.updated_at)}</span>
      </div>
      {showState && <Pill tone={row.publication_state} />}
    </div>)}
  </div>;
}

function IssueSteps({ issue }: { issue: PrintIssue }) {
  const index = issue.status === "queued" ? 0 : issue.status === "processing" ? 1 : 3;
  const steps = ["Queued", "Extracting", "In review"];
  return <div className="ed-steps">{steps.map((label, step) => <span key={label} className="ed-step" data-state={step < index ? "done" : step === index ? "active" : "todo"}><i />{label}</span>)}</div>;
}

export function HomeDesk() {
  const { brand, data, demo, href, mutationVersion, user } = useEditorial();
  const { openCreate } = useShell();
  const overview = useAsync(`home-overview:${brand}:${mutationVersion}`, signal => data.overview(brand, signal));
  const review = useAsync(`home-review:${brand}:${mutationVersion}`, signal => data.listDocuments({ brand, state: "review" }, signal));
  const recent = useAsync(`home-recent:${brand}:${mutationVersion}`, signal => data.listDocuments({ brand }, signal));
  const published = useAsync(`home-published:${brand}:${mutationVersion}`, signal => data.listDocuments({ brand, state: "published" }, signal));
  const issues = useAsync(`home-issues:${brand}:${mutationVersion}`, signal => data.listIssues(brand, signal));
  const scheduled = useAsync(`home-schedule:${brand}:${mutationVersion}`, signal => loadScheduledDocuments(data, brand, signal, 40));
  const now = useMemo(() => new Date(), []);
  const publishedThisWeek = (published.data?.documents ?? []).filter(row => isWithinDays(row.published_at, 7, now));
  const upcoming = (scheduled.data?.scheduled ?? []).filter(entry => new Date(entry.publishAt) >= now).slice(0, 5);
  const activeIssues = (issues.data ?? []).filter(issue => issue.status !== "published").slice(0, 4);
  const firstName = demo ? "there" : user.email.split("@")[0].split(/[._-]/)[0].replace(/^\w/, c => c.toUpperCase());

  return <div className="ed-stack">
    <section className="ed-hero">
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>
        <div className="ed-hero-copy" style={{ maxWidth: 640 }}>
          <p className="muted" style={{ fontSize: 12.5, fontWeight: 500 }}>{greeting(now)}, {firstName} · {BRAND_NAMES[brand]}</p>
          <h2 style={{ marginTop: 6 }}>
            {overview.data ? <>{overview.data.review} {overview.data.review === 1 ? "story needs" : "stories need"} review{upcoming.length ? `, ${upcoming.length} scheduled ahead` : ""}.</> : <Skeleton width={320} height={28} style={{ background: "rgb(255 255 255 / 0.12)" }} />}
          </h2>
          <p style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.55 }}>Review what arrived, schedule what is ready, and keep every story&rsquo;s history.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
            <Button icon={Plus} onClick={() => openCreate("article")}>New article</Button>
            <LinkButton href={href("/cms/review")} variant="primary" className="secondary" icon={ClipboardCheck}>Open review queue</LinkButton>
            {!demo && <LinkButton href={href("/admin/new")} variant="primary" className="secondary" icon={FileInput}>Upload an issue</LinkButton>}
          </div>
        </div>
      </div>
    </section>

    <Card pad={false} className="still">
      <div className="ed-kpi-strip">
        {[
          { label: "All content", value: overview.data?.total, icon: LibraryBig, href: href("/cms/library"), hint: "Articles, ratings, pages and records" },
          { label: "Needs review", value: overview.data?.review, icon: ClipboardCheck, href: href("/cms/review"), hint: "Waiting on an editor" },
          { label: "Drafts", value: overview.data?.drafts, icon: PenLine, href: href("/cms/library", { state: "draft" }), hint: "Original work in progress" },
          { label: "Ratings", value: overview.data?.ratings, icon: Star, href: href("/cms/library", { kind: "rating" }), hint: "Structured tasting notes" },
        ].map(kpi => <Link key={kpi.label} href={kpi.href} className="ed-kpi">
          <span className="ed-kpi-label">{kpi.label}<kpi.icon size={15} strokeWidth={1.75} aria-hidden /></span>
          <strong>{kpi.value == null ? <Skeleton width={48} height={28} /> : kpi.value}</strong>
          <small>{kpi.hint}</small>
        </Link>)}
      </div>
    </Card>

    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))" }}>
      <Card>
        <SectionHead title="Review queue" detail="Print extractions and imports waiting on an editor" action={<LinkButton href={href("/cms/review")} size="sm" icon={ArrowRight}>All</LinkButton>} />
        <DocumentList rows={review.data?.documents.slice(0, 6)} loading={review.loading} empty="Nothing is waiting for review." href={href} />
      </Card>
      <Card>
        <SectionHead title="Recently edited" detail="Across every state in this publication" action={<LinkButton href={href("/cms/library")} size="sm" icon={ArrowRight}>Library</LinkButton>} />
        <DocumentList rows={recent.data?.documents.slice(0, 6)} loading={recent.loading} empty="No documents yet. Create one or upload a print issue." href={href} showState />
      </Card>
    </div>

    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))" }}>
      <Card>
        <SectionHead title="Coming up" detail={scheduled.data?.truncated ? `Planned publish times from the ${scheduled.data.scanned} most recently edited drafts` : "Planned publish times"} action={<LinkButton href={href("/cms/schedule")} size="sm" icon={CalendarDays}>Calendar</LinkButton>} />
        {scheduled.loading && !scheduled.data ? <SkeletonRows rows={3} /> : upcoming.length ? <div className="ed-list">
          {upcoming.map(({ document, publishAt }) => <div key={document.id} className="ed-row">
            <div className="grow"><Link className="title" href={href(`/cms/doc/${document.id}`)}>{document.title}</Link><span className="meta">{formatDate(publishAt, { weekday: "short", month: "short", day: "numeric" })} · {new Date(publishAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span></div>
            <Pill tone="scheduled" />
          </div>)}
        </div> : <Empty icon={CalendarDays} title="Nothing scheduled" text="Set a publish time from a document&rsquo;s properties and it appears here and on the calendar." />}
      </Card>
      <Card>
        <SectionHead title="Print intake" detail="Issues moving through extraction" action={<LinkButton href={href("/cms/print")} size="sm" icon={ArrowRight}>All issues</LinkButton>} />
        {issues.loading && !issues.data ? <SkeletonRows rows={3} /> : activeIssues.length ? <div className="ed-list">
          {activeIssues.map(issue => <div key={issue.id} className="ed-row">
            <div className="grow">
              <Link className="title" href={issue.status === "review" ? href("/cms/library", { issue: issue.id }) : href(`/admin/${issue.id}`)}>{issue.issue_label}</Link>
              <span className="meta">{issue.status === "review" ? `${issue.articleCount ?? 0} candidates in the library · ${relativeTime(issue.created_at)}` : issue.status === "failed" ? issue.error || "The worker failed." : <IssueSteps issue={issue} />}</span>
            </div>
            <Pill tone={issue.status}>{issue.status === "review" ? "Ready to review" : issue.status === "processing" ? "Processing" : issue.status === "failed" ? "Failed" : "Queued"}</Pill>
          </div>)}
        </div> : <Empty icon={FileInput} title="No issues in progress" text={demo ? "Sample issues appear here when the demo has print content." : "Upload a production PDF and the worker turns it into review candidates."} action={!demo ? <LinkButton href={href("/admin/new")} size="sm" icon={ArrowUpRight}>Upload an issue</LinkButton> : undefined} />}
      </Card>
    </div>

    <Card>
      <SectionHead title="Published this week" detail="Live stories and ratings from the last seven days" action={<LinkButton href={href("/cms/library", { state: "published" })} size="sm" icon={ArrowRight}>All published</LinkButton>} />
      {published.loading && !published.data ? <SkeletonRows rows={3} /> : publishedThisWeek.length ? <div className="ed-list">
        {publishedThisWeek.slice(0, 6).map(row => <div key={row.id} className="ed-row">
          <FileText size={15} style={{ color: "var(--muted)" }} aria-hidden />
          <div className="grow"><Link className="title" href={href(`/cms/doc/${row.id}`)}>{row.title}</Link><span className="meta">{CONTENT_TYPE_LABELS[row.kind].singular}{row.byline ? ` · ${row.byline}` : ""} · published {formatDate(row.published_at, { weekday: "short", month: "short", day: "numeric" })}</span></div>
        </div>)}
      </div> : <Empty icon={House} title="Nothing published this week" text="Imported records keep their original publication dates; new print content enters review first." />}
    </Card>
  </div>;
}
