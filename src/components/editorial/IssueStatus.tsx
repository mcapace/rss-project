"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ExternalLink, FileInput, Images, MessageSquareWarning, Newspaper, RefreshCw } from "lucide-react";
import { BRAND_NAMES, formatDate } from "@/lib/editorial/helpers";
import type { PrintIssue } from "@/lib/editorial/data";
import { useEditorial } from "./EditorialProvider";
import { useAsync } from "./hooks";
import { usePageTitle } from "./Shell";
import { Button, Card, Empty, LinkButton, Notice, PageHeader, Pill, Skeleton } from "./ui";

type IssueDetail = { issue: PrintIssue; articleCount: number; imageCount: number | null; feedUrl: string | null };

const STATUS_LABELS: Record<PrintIssue["status"], string> = { queued: "Queued", processing: "Processing", review: "Ready to review", published: "Published", failed: "Failed" };

async function fetchIssue(id: string, signal: AbortSignal): Promise<IssueDetail> {
  const response = await fetch(`/api/issues/${encodeURIComponent(id)}`, { signal, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error || "The issue could not be loaded.");
  return data as IssueDetail;
}

function Steps({ status }: { status: PrintIssue["status"] }) {
  const index = status === "queued" ? 0 : status === "processing" ? 1 : status === "failed" ? -1 : 3;
  return <div className="ed-steps">{["Queued", "Extracting and segmenting", "Candidates in review"].map((label, step) => <span key={label} className="ed-step" data-state={index === -1 ? "todo" : step < index ? "done" : step === index ? "active" : "todo"}><i />{label}</span>)}</div>;
}

/** One print issue: where extraction stands, what it produced, and what to do next. */
export function IssueStatus({ issueId }: { issueId: string }) {
  const { brand, brands, setBrand, href, demo, refresh } = useEditorial();
  const [tick, setTick] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const detail = useAsync(`issue:${issueId}`, signal => fetchIssue(issueId, signal), { enabled: !demo, refreshToken: tick });
  const issue = detail.data?.issue ?? null;
  const live = issue?.status === "queued" || issue?.status === "processing";
  usePageTitle(issue?.issue_label ?? "Issue");

  // The issue's own publication wins over a stale query string so every link stays in scope.
  const issueBrand = issue?.brand ?? null;
  useEffect(() => {
    if (issueBrand && issueBrand !== brand && brands.includes(issueBrand)) setBrand(issueBrand);
  }, [issueBrand, brand, brands, setBrand]);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setTick(value => value + 1), 5_000);
    return () => clearInterval(timer);
  }, [live]);

  async function retry() {
    if (!issue || retrying) return;
    setRetrying(true); setRetryError(null);
    try {
      const response = await fetch("/api/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand: issue.brand, issueId: issue.issue_id, issueLabel: issue.issue_label, tocPages: issue.toc_pages?.join(",") || "3,4", pdfKey: issue.pdf_key }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.error) throw new Error(result.error || "Extraction could not restart.");
      setTick(value => value + 1); refresh();
    } catch (failure) { setRetryError(failure instanceof Error ? failure.message : "Extraction could not restart."); }
    finally { setRetrying(false); }
  }

  if (demo) {
    return <>
      <PageHeader icon={FileInput} title="Issue status" actions={<LinkButton href={href("/cms/print")} icon={ArrowLeft}>Print intake</LinkButton>} />
      <Card><Empty icon={FileInput} title="Issue pages need the connected workspace" text="The demo keeps sample content only. Sign in to follow a print issue through extraction." action={<LinkButton href="/login" variant="primary">Sign in</LinkButton>} /></Card>
    </>;
  }

  if (detail.loading && !detail.data) {
    return <>
      <PageHeader icon={FileInput} title="Loading issue…" actions={<LinkButton href={href("/cms/print")} icon={ArrowLeft}>Print intake</LinkButton>} />
      <Card aria-busy="true"><div style={{ display: "grid", gap: 14 }}><Skeleton width="40%" height={18} /><Skeleton width="70%" /><Skeleton height={120} radius={12} /></div></Card>
    </>;
  }

  if (!issue) {
    return <>
      <PageHeader icon={FileInput} title="Issue unavailable" actions={<LinkButton href={href("/cms/print")} icon={ArrowLeft}>Print intake</LinkButton>} />
      <Card><Empty icon={AlertTriangle} title="This issue could not be loaded" text={detail.error ?? "Issue information is unavailable."} action={<Button onClick={detail.reload} icon={RefreshCw}>Try again</Button>} /></Card>
    </>;
  }

  const status = issue.status;
  const articleCount = detail.data?.articleCount ?? (typeof issue.stats?.cms_document_count === "number" ? issue.stats.cms_document_count : null);
  const imageCount = detail.data?.imageCount ?? null;
  const warnings = typeof issue.stats?.warning_count === "number" ? issue.stats.warning_count : null;
  const candidatesHref = href("/cms/library", { issue: issue.id });

  return <>
    <PageHeader icon={FileInput} title={issue.issue_label} lede={`${BRAND_NAMES[issue.brand]} · Issue ${issue.issue_id} · Added ${formatDate(issue.created_at, { month: "short", day: "numeric", year: "numeric" })}`}
      actions={<>
        <Pill tone={status}>{STATUS_LABELS[status]}</Pill>
        <Button icon={RefreshCw} onClick={() => { setTick(value => value + 1); }} disabled={detail.refreshing}>{detail.refreshing ? "Refreshing…" : "Refresh"}</Button>
        <LinkButton href={href("/cms/print")} icon={ArrowLeft}>Print intake</LinkButton>
      </>} />
    <div className="ed-stack" style={{ maxWidth: 900 }}>
      {detail.error && <Notice tone="error">The status could not be refreshed. {detail.error} The information below may be out of date.</Notice>}

      <Card>
        <Steps status={status} />
        <div style={{ marginTop: 18 }}>
          {live && <Notice icon={RefreshCw}>{status === "queued" ? "The request is queued. This page updates every few seconds until the candidates are ready or the attempt needs attention." : "The worker is extracting text and images and segmenting articles. Candidates appear in the review queue when it finishes."}</Notice>}
          {status === "review" && <Notice tone="success" icon={Check}>Candidates are ready. Open them in the library to check text, bylines, images and extraction notes before publishing. Re-extracting keeps editorial changes and adds new source candidates.</Notice>}
          {status === "failed" && <Notice tone="error" icon={AlertTriangle}>{issue.error || "The issue could not be fully extracted. Retry, or check the PDF and the table-of-contents pages."} Previously saved articles are still in the library.</Notice>}
          {status === "published" && <Notice>This issue was published through the earlier feed workflow. New extractions create candidates for review instead.</Notice>}
        </div>
      </Card>

      <div className="ed-kpi-strip ed-card still">
        <div className="ed-kpi"><span className="ed-kpi-label">Articles<Newspaper size={14} aria-hidden /></span><strong>{articleCount ?? "—"}</strong><small>Candidates in the library</small></div>
        <div className="ed-kpi"><span className="ed-kpi-label">Source images<Images size={14} aria-hidden /></span><strong>{imageCount ?? "—"}</strong><small>Kept from the PDF</small></div>
        <div className="ed-kpi"><span className="ed-kpi-label">Extraction notes<MessageSquareWarning size={14} aria-hidden /></span><strong>{warnings ?? "—"}</strong><small>Items for an editor to check</small></div>
        <div className="ed-kpi"><span className="ed-kpi-label">Contents pages<FileInput size={14} aria-hidden /></span><strong>{issue.toc_pages?.length ? issue.toc_pages.join(", ") : "—"}</strong><small>PDF pages read for the table of contents</small></div>
      </div>

      <Card>
        <div className="ed-form-actions" style={{ justifyContent: "flex-start", borderTop: 0, paddingTop: 0 }}>
          {(status === "review" || (articleCount ?? 0) > 0) && <LinkButton href={candidatesHref} variant="primary" icon={ArrowRight}>{status === "review" ? "Review candidates" : "Open existing articles"}</LinkButton>}
          {status === "failed" && <Button icon={RefreshCw} onClick={retry} disabled={retrying}>{retrying ? "Restarting…" : "Retry extraction"}</Button>}
          {detail.data?.feedUrl && <a className="ed-button" href={detail.data.feedUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} aria-hidden />Legacy RSS feed</a>}
          <Link className="ed-link" href={href("/cms")} style={{ marginLeft: "auto", fontSize: 13 }}>Go to the home desk</Link>
        </div>
        {retryError && <div style={{ marginTop: 12 }}><Notice tone="error">{retryError}</Notice></div>}
      </Card>
    </div>
  </>;
}
