"use client";

import { use, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ExternalLink, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { BrandMark } from "@/components/ui/BrandMark";
import { Skeleton } from "@/components/ui/Skeleton";
import { BRANDS } from "@/lib/brands";

interface IssueDetail {
  issue: {
    id: string;
    brand: string;
    issue_id: string;
    issue_label: string;
    pdf_key: string;
    status: string;
    created_at: string;
    error?: string | null;
    toc_pages?: number[];
    stats?: { cms_document_count?: number; warning_count?: number } | null;
  };
  articleCount: number;
  imageCount?: number;
  feedUrl?: string;
}

async function fetchIssue(url: string): Promise<IssueDetail> {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || "Could not load the issue.");
  return data;
}

export default function IssueStatusPage({ params }: { params: Promise<{ issueUuid: string }> }) {
  const { issueUuid } = use(params);
  const [retryPending, setRetryPending] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const { data, error, mutate, isValidating } = useSWR<IssueDetail, Error>(`/api/issues/${encodeURIComponent(issueUuid)}`, fetchIssue, {
    refreshInterval: (latest) => latest?.issue?.status === "queued" || latest?.issue?.status === "processing" ? 5000 : 0,
    revalidateOnFocus: true,
  });
  const issue = data?.issue;

  async function retryExtraction() {
    if (!issue || retryPending) return;
    setRetryError(null);
    setRetryPending(true);
    try {
      const response = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand: issue.brand, issueId: issue.issue_id, issueLabel: issue.issue_label, tocPages: issue.toc_pages?.join(",") || "3,4", pdfKey: issue.pdf_key }),
      });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || "Extraction could not restart.");
      await mutate();
    } catch (failure) {
      setRetryError(failure instanceof Error ? failure.message : "Extraction could not restart.");
    } finally {
      setRetryPending(false);
    }
  }

  const backLink = <Link href="/admin" className="inline-flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900"><ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Back to issues</Link>;

  if (!data && !error) return (
    <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-10 space-y-6" aria-busy="true">
      {backLink}<p className="sr-only" role="status">Loading issue…</p><Skeleton className="w-64 h-10 rounded" /><Card padding="lg"><Skeleton className="h-36 rounded-xl" /></Card>
    </main>
  );

  if (!issue) return (
    <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-10 space-y-6">
      {backLink}
      <Card padding="lg"><h1 className="font-serif text-2xl text-gray-900">Could not load this issue</h1><p role="alert" className="text-sm text-red-700 mt-3">{error?.message || "Issue information is unavailable."}</p><Button type="button" variant="outline" className="mt-5" disabled={isValidating} onClick={() => void mutate()}>Try again</Button></Card>
    </main>
  );

  const status = issue.status;
  const articleCount = data?.articleCount ?? issue.stats?.cms_document_count;
  const warningCount = issue.stats?.warning_count;
  const cmsUrl = `/cms?issue=${encodeURIComponent(issue.id)}&brand=${encodeURIComponent(issue.brand)}`;

  return (
    <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-10 space-y-7">
      <div className="space-y-4">
        {backLink}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-500">Print to web</p><h1 className="font-serif text-3xl sm:text-4xl text-gray-900 mt-1">{issue.issue_label}</h1></div>
          <StatusBadge status={status} brand={issue.brand} />
        </div>
      </div>

      {error && <div role="alert" className="p-4 rounded-xl border border-red-200 bg-red-50 text-sm text-red-800"><p className="font-semibold">The status could not be refreshed.</p><p>{error.message} The information below may be out of date.</p></div>}

      <Card elevated padding="lg" className="space-y-7">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-gray-100">
          <div className="flex items-center gap-3"><BrandMark brand={issue.brand} size="lg" /><div><p className="font-medium text-gray-900">{BRANDS[issue.brand]?.name ?? issue.brand}</p><p className="text-xs text-gray-500 mt-1">Issue ID: {issue.issue_id}</p></div></div>
          <p className="text-xs text-gray-500">{issue.created_at ? `Added ${new Date(issue.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : ""}</p>
        </div>

        {(status === "queued" || status === "processing") && (
          <section className="p-6 rounded-xl bg-amber-50/60 border border-amber-200 space-y-3" aria-labelledby="extraction-title">
            <div className="flex items-center gap-3"><RefreshCw className="w-5 h-5 text-amber-700 animate-spin" aria-hidden="true" /><h2 id="extraction-title" className="font-serif text-2xl text-gray-900">{status === "queued" ? "Extraction requested" : "Extraction in progress"}</h2></div>
            <p className="text-sm leading-relaxed text-gray-700">{status === "queued" ? "The request is queued or being processed. This page will update when the drafts are ready or the attempt needs attention." : "The issue is being prepared for editorial review. Articles and source images will appear in the CMS when extraction finishes."}</p>
            <p className="text-xs text-gray-600">You can leave this page and return to the issue list to check its status.</p>
          </section>
        )}

        {status === "review" && (
          <section className="p-6 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-5" aria-labelledby="drafts-title">
            <div className="flex items-center gap-3"><Check className="w-6 h-6 text-emerald-700" aria-hidden="true" /><h2 id="drafts-title" className="font-serif text-2xl text-gray-900">Drafts ready</h2></div>
            <p className="text-sm leading-relaxed text-gray-700">Open the articles in the CMS to review their text, bylines, images, and extraction notes before publishing. Re-extraction keeps existing editorial changes and adds source candidates for review.</p>
            <dl className="flex flex-wrap gap-x-10 gap-y-4">
              {typeof articleCount === "number" && <div><dt className="text-xs text-gray-600">CMS articles</dt><dd className="text-3xl font-semibold text-gray-900 tabular-nums mt-1">{articleCount}</dd></div>}
              {typeof data?.imageCount === "number" && <div><dt className="text-xs text-gray-600">Source images</dt><dd className="text-3xl font-semibold text-gray-900 tabular-nums mt-1">{data.imageCount}</dd></div>}
              {typeof warningCount === "number" && <div><dt className="text-xs text-gray-600">Extraction notes</dt><dd className="text-3xl font-semibold text-gray-900 tabular-nums mt-1">{warningCount}</dd></div>}
            </dl>
            <Link href={cmsUrl} className="inline-flex items-center gap-2 rounded-lg bg-[#B85D19] px-5 py-3 text-sm font-semibold text-white hover:bg-[#9D4F15] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2">Review articles in CMS <ArrowRight className="w-4 h-4" aria-hidden="true" /></Link>
          </section>
        )}

        {status === "failed" && (
          <section className="p-6 rounded-xl bg-red-50 border border-red-200 space-y-4" aria-labelledby="failure-title">
            <div className="flex items-center gap-3"><AlertTriangle className="w-5 h-5 text-red-700" aria-hidden="true" /><h2 id="failure-title" className="font-serif text-2xl text-gray-900">Extraction needs attention</h2></div>
            <p className="text-sm text-red-800">{issue.error || "The issue could not be fully extracted. Retry the extraction, or check the PDF and table of contents pages."}</p>
            <p className="text-sm text-gray-700">Previously saved CMS articles remain available.</p>
            <Button type="button" variant="outline" onClick={() => void retryExtraction()} isLoading={retryPending}><RefreshCw className="w-4 h-4" aria-hidden="true" /> Retry extraction</Button>
            {retryError && <p role="alert" className="text-sm text-red-800">{retryError}</p>}
          </section>
        )}

        {status === "published" && (
          <section className="rounded-xl border border-gray-200 bg-gray-50 p-6 space-y-3" aria-labelledby="legacy-title">
            <h2 id="legacy-title" className="font-serif text-2xl text-gray-900">Previously published issue</h2>
            <p className="text-sm text-gray-600">This issue was published through the earlier feed workflow. New PDF extractions create articles for review in the CMS.</p>
            {typeof articleCount === "number" && <p className="text-sm text-gray-700">{articleCount} articles in the legacy issue.</p>}
            {data?.feedUrl && <a href={data.feedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-gray-700 underline underline-offset-4 hover:text-[#B85D19]">Open legacy RSS feed <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /></a>}
          </section>
        )}

        {!["queued", "processing", "review", "failed", "published"].includes(status) && <p className="text-sm text-gray-600" role="status">The issue status is unavailable. Refresh to check again.</p>}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-gray-100">
          {status !== "review" && status !== "published" && typeof articleCount === "number" && articleCount > 0 ? <Link href={cmsUrl} className="text-sm text-[#9D4F15] font-medium underline underline-offset-4">Open existing CMS articles</Link> : <Link href="/cms" className="text-sm text-gray-600 hover:text-gray-900 underline underline-offset-4">Go to CMS</Link>}
          <Button type="button" variant="ghost" size="sm" onClick={() => void mutate()} disabled={isValidating}><RefreshCw className={`w-3.5 h-3.5 ${isValidating ? "animate-spin" : ""}`} aria-hidden="true" /> {isValidating ? "Refreshing…" : "Refresh status"}</Button>
        </div>
      </Card>
    </main>
  );
}
