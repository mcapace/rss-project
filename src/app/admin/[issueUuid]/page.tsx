"use client";

import { use, useState, useTransition } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  ArrowLeft,
  Copy,
  Check,
  ExternalLink,
  RotateCw,
  AlertTriangle,
  FileCheck2,
  Image as ImageIcon,
  BookOpen,
  Globe,
  Sparkles,
  Layers,
  FileText,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { BrandMark } from "@/components/ui/BrandMark";
import { Skeleton } from "@/components/ui/Skeleton";
import { BRANDS } from "@/lib/brands";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || "Failed to fetch data");
  }
  return data;
};

export default function IssueStatusPage({
  params,
}: {
  params: Promise<{ issueUuid: string }>;
}) {
  const resolvedParams = use(params);
  const { issueUuid } = resolvedParams;

  const [copied, setCopied] = useState(false);
  const [retryPending, startRetryTransition] = useTransition();
  const [retryError, setRetryError] = useState<string | null>(null);

  // Poll every 5s while processing or queued
  const { data, error, mutate } = useSWR(
    `/api/issues/${issueUuid}`,
    fetcher,
    {
      refreshInterval: (latestData) => {
        const currentStatus = latestData?.issue?.status;
        if (currentStatus === "queued" || currentStatus === "processing") {
          return 5000;
        }
        return 0; // stop polling once published or failed
      },
      revalidateOnFocus: true,
    }
  );

  const issue = data?.issue;
  const brand = issue ? BRANDS[issue.brand] || BRANDS.mw : BRANDS.mw;
  const status = issue?.status || "processing";
  const stats = issue?.stats;

  const copyFeedUrl = () => {
    if (!issue) return;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const fullUrl = `${origin}${data.feedUrl}`;
    navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRetry = () => {
    if (!issue) return;
    setRetryError(null);
    startRetryTransition(async () => {
      try {
        const res = await fetch("/api/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brand: issue.brand,
            issueId: issue.issue_id,
            issueLabel: issue.issue_label,
            tocPages: issue.toc_pages?.join(",") || "3,4",
            pdfKey: issue.pdf_key,
          }),
        });

        const resData = await res.json();
        if (!res.ok || resData.error) {
          throw new Error(resData.error || "Retry initiation failed");
        }
        mutate();
      } catch (err: any) {
        setRetryError(err.message || "Failed to trigger retry");
      }
    });
  };

  // Three-step pipeline logic for progress animation
  // 1. Extracting (pages/images) -> 2. Segmenting (Claude AI structuring) -> 3. Publishing (S3/Supabase)
  const isQueued = status === "queued";
  const isProcessing = status === "processing";
  const isPublished = status === "published";
  const isFailed = status === "failed";

  if (!data && !error) {
    return (
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-10 space-y-8">
        <div>
          <Skeleton className="w-24 h-4 rounded mb-3" />
          <div className="flex justify-between items-center">
            <Skeleton className="w-64 h-9 rounded" />
            <Skeleton className="w-24 h-6 rounded-full" />
          </div>
        </div>
        <Card elevated padding="lg" className="space-y-6">
          <div className="flex justify-between items-center pb-6 border-b border-gray-100">
            <div className="flex items-center gap-3.5">
              <Skeleton className="w-8 h-8 rounded" />
              <div>
                <Skeleton className="w-48 h-6 rounded mb-1" />
                <Skeleton className="w-32 h-3 rounded" />
              </div>
            </div>
            <Skeleton className="w-24 h-6 rounded" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-10 space-y-8">
      {/* Back Link & Page Title */}
      <div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 transition-colors mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Issues</span>
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-500">
              Publishing Pipeline • Issue Status
            </span>
            <h1 className="font-serif text-3xl sm:text-4xl text-gray-900 font-normal tracking-tight mt-1">
              {issue?.issue_label || "Issue Processing"}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={status} brand={issue?.brand} />
          </div>
        </div>
      </div>

      {/* Hero Card */}
      <Card elevated padding="lg" className="space-y-8">
        {/* Header with Brand, Label, ID & Date */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-gray-100">
          <div className="flex items-center gap-3.5">
            <BrandMark brand={issue?.brand || "mw"} size="lg" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-serif text-2xl text-gray-900 font-normal">
                  {issue?.issue_label || "Loading..."}
                </h2>
                <span className="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
                  {issue?.issue_id}
                </span>
              </div>
              <p className="text-xs font-mono text-gray-500 mt-1">
                {issue?.pdf_key || "Direct S3 PDF Package"}
              </p>
            </div>
          </div>

          <div className="text-left sm:text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Registered
            </div>
            <div className="text-xs font-mono text-gray-900 mt-0.5">
              {issue?.created_at
                ? new Date(issue.created_at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—"}
            </div>
          </div>
        </div>

        {/* PROCESSING / QUEUED STATE */}
        {(isProcessing || isQueued) && (
          <div className="space-y-8 py-4">
            {/* 3-Step Progress Indicator */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Step 1: Extracting */}
              <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    Step 1
                  </span>
                  <span className="w-2 h-2 rounded-full bg-[#C9A227] animate-pulse" />
                </div>
                <div className="text-sm font-semibold text-gray-900 mt-2 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[#C9A227]" />
                  <span>Extracting</span>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">
                  Parsing PDF pages, text coordinates, and raw images.
                </p>
              </div>

              {/* Step 2: Segmenting */}
              <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    Step 2
                  </span>
                  <Sparkles className="w-3.5 h-3.5 text-[#C9A227] opacity-60" />
                </div>
                <div className="text-sm font-semibold text-gray-900 mt-2 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[#C9A227]" />
                  <span>Segmenting</span>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">
                  Claude AI TOC mapping & BlueToad HTML formatting.
                </p>
              </div>

              {/* Step 3: Publishing */}
              <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    Step 3
                  </span>
                  <Globe className="w-3.5 h-3.5 text-gray-400 opacity-60" />
                </div>
                <div className="text-sm font-semibold text-gray-900 mt-2 flex items-center gap-2">
                  <FileCheck2 className="w-4 h-4 text-gray-400" />
                  <span>Publishing</span>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">
                  Writing S3 images and Supabase article database.
                </p>
              </div>
            </div>

            {/* Live Polling Status Note */}
            <div className="p-5 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <RotateCw className="w-4 h-4 text-[#C9A227] animate-spin" />
                <div>
                  <div className="text-xs font-semibold text-gray-900">
                    GitHub Worker running in background
                  </div>
                  <div className="text-[11px] text-gray-500">
                    Polling live status every 5 seconds. Processing typically takes 3–8 minutes.
                  </div>
                </div>
              </div>
              <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500 px-2 py-1 bg-white rounded border border-gray-200 shadow-xs">
                Live SWR
              </span>
            </div>
          </div>
        )}

        {/* PUBLISHED SUCCESS STATE */}
        {isPublished && (
          <div className="space-y-6 py-2">
            <div className="p-6 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 border border-emerald-200 flex items-center justify-center text-emerald-700">
                  <Check className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-serif text-xl text-gray-900 font-normal">
                    Issue Successfully Published
                  </h3>
                  <p className="text-xs text-gray-600 mt-0.5">
                    Live RSS feed is active and ready for migration tool consumption.
                  </p>
                </div>
              </div>

              {/* Feed URL Field */}
              <div className="space-y-1.5 pt-2">
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-600">
                  Public RSS Feed URL
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-4 py-2.5 bg-white border border-emerald-200 rounded-lg text-xs font-mono text-emerald-800 font-medium truncate select-all shadow-xs">
                    {typeof window !== "undefined"
                      ? `${window.location.origin}${data.feedUrl}`
                      : data?.feedUrl}
                  </div>
                  <Button
                    onClick={copyFeedUrl}
                    variant="ghost"
                    size="md"
                    className="shrink-0 font-mono text-xs bg-white hover:bg-gray-50"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
                        <span className="text-emerald-700 font-medium">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 mr-1.5" />
                        <span>Copy Feed</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>

            {/* Metrics Breakdown */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-[#C9A227]" />
                  <span>Articles</span>
                </div>
                <div className="text-2xl font-mono text-gray-900 font-semibold mt-1">
                  {data?.articleCount ?? "—"}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5 text-[#C9A227]" />
                  <span>Extracted Images</span>
                </div>
                <div className="text-2xl font-mono text-gray-900 font-semibold mt-1">
                  {data?.imageCount ?? "—"}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 col-span-2 sm:col-span-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-[#C9A227]" />
                  <span>Format</span>
                </div>
                <div className="text-xs font-mono text-gray-900 mt-2 font-medium">
                  RSS 2.0 • BlueToad
                </div>
              </div>
            </div>

            {/* Actions Bar */}
            <div className="flex flex-wrap items-center justify-end gap-3 pt-4 border-t border-gray-100">
              <a
                href={data?.feedUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="ghost" size="md">
                  <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                  Open Feed XML
                </Button>
              </a>

              <Link
                href={`/?url=${encodeURIComponent(
                  typeof window !== "undefined"
                    ? `${window.location.origin}${data?.feedUrl}`
                    : data?.feedUrl || ""
                )}`}
              >
                <Button variant="primary" size="md">
                  <Globe className="w-3.5 h-3.5 mr-1.5" />
                  Preview in Reader
                </Button>
              </Link>
            </div>
          </div>
        )}

        {/* FAILED STATE */}
        {isFailed && (
          <div className="space-y-6 py-2">
            <div className="p-6 rounded-xl bg-rose-50 border border-rose-200 space-y-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-serif text-lg text-rose-950 font-normal">
                    Processing Execution Failed
                  </h3>
                  <p className="text-xs text-rose-700 mt-1 font-mono break-words">
                    {issue?.error || "Unknown worker failure during PDF extraction or Claude segmentation."}
                  </p>
                </div>
              </div>
            </div>

            {retryError && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                {retryError}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
              <Link href="/admin">
                <Button variant="ghost" size="md">
                  Return to Issues
                </Button>
              </Link>
              <Button
                onClick={handleRetry}
                variant="primary"
                size="md"
                isLoading={retryPending}
              >
                <RotateCw className="w-3.5 h-3.5 mr-1.5" />
                Retry Pipeline
              </Button>
            </div>
          </div>
        )}
      </Card>
    </main>
  );
}
