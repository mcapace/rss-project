"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { AlertCircle, ArrowRight, FolderOpen, Plus, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { BrandMark } from "@/components/ui/BrandMark";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TableRowSkeleton } from "@/components/ui/Skeleton";
import { BRANDS } from "@/lib/brands";

interface IssueItem {
  id: string;
  brand: string;
  issue_id: string;
  issue_label: string;
  status: string;
  articleCount: number;
  created_at: string;
  feedUrl?: string;
}

const fetcher = async (url: string): Promise<{ issues: IssueItem[] }> => {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || "Could not load issues.");
  return data;
};

const brandOptions = [BRANDS.wa, ...Object.values(BRANDS).filter((brand) => brand.id !== "wa")];
const primaryLinkClass = "inline-flex items-center justify-center gap-2 rounded-lg bg-[#B85D19] px-4 py-2 text-sm font-semibold text-white hover:bg-[#9D4F15] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2";

export default function AdminIssuesPage() {
  const [selectedBrandFilter, setSelectedBrandFilter] = useState("wa");
  const { data, error, isLoading, isValidating, mutate } = useSWR<{ issues: IssueItem[] }, Error>(
    "/api/issues", fetcher, { refreshInterval: 10000, revalidateOnFocus: true },
  );
  const issues = data?.issues ?? [];
  const filteredIssues = issues.filter((issue) => selectedBrandFilter === "all" || issue.brand.toLowerCase() === selectedBrandFilter);

  return (
    <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-10 space-y-7">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-5 border-b border-gray-200">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-500">Print to web</p>
          <h1 className="font-serif text-3xl sm:text-4xl text-gray-900 mt-1">Print issues</h1>
          <p className="text-sm text-gray-600 mt-2">Turn issue PDFs into articles for your editors to review in the CMS.</p>
        </div>
        <Link href="/admin/new" className={primaryLinkClass}>
          <Plus className="w-4 h-4" aria-hidden="true" /> New issue
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2" aria-label="Filter by publication">
          {[{ id: "all", name: "All publications" }, ...brandOptions].map((brand) => (
            <button
              key={brand.id}
              type="button"
              aria-pressed={selectedBrandFilter === brand.id}
              onClick={() => setSelectedBrandFilter(brand.id)}
              className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 ${selectedBrandFilter === brand.id ? "bg-white border-gray-300 text-gray-900 shadow-xs" : "border-transparent text-gray-600 hover:bg-gray-100"}`}
            >
              {brand.name}
            </button>
          ))}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => void mutate()} disabled={isValidating}>
          <RefreshCw className={`w-3.5 h-3.5 ${isValidating ? "animate-spin" : ""}`} aria-hidden="true" />
          {isValidating ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div><p className="font-semibold">Could not refresh the issue list.</p><p>{error.message}</p>{data && <p className="mt-1">The list below may be out of date.</p>}</div>
        </div>
      )}

      <Card padding="none" className="overflow-hidden">
        {error && !data ? (
          <div className="p-12 text-center"><p className="text-gray-600 mb-4">Issue information is currently unavailable.</p><Button type="button" variant="outline" onClick={() => void mutate()} disabled={isValidating}>Try again</Button></div>
        ) : !isLoading && filteredIssues.length === 0 ? (
          <div className="py-20 px-6 text-center space-y-4">
            <FolderOpen className="w-9 h-9 mx-auto text-gray-400" aria-hidden="true" />
            <h2 className="font-serif text-2xl text-gray-900">No issues in this view</h2>
            <p className="text-sm text-gray-600 max-w-md mx-auto">Upload a print issue to create review drafts, or choose another publication to find an existing issue.</p>
            <Link href="/admin/new" className={primaryLinkClass}><Plus className="w-4 h-4" aria-hidden="true" /> New issue</Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <caption className="sr-only">Print issues and their extraction status</caption>
              <thead className="border-b border-gray-200 bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                <tr>{["Publication", "Issue", "Status", "Articles", "Created", "Actions"].map((heading) => <th key={heading} scope="col" className="py-3.5 px-5 font-medium">{heading}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {isLoading && !data ? <><TableRowSkeleton /><TableRowSkeleton /><TableRowSkeleton /></> : filteredIssues.map((issue) => (
                  <tr key={issue.id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="py-4 px-5 whitespace-nowrap"><div className="flex items-center gap-2"><BrandMark brand={issue.brand} size="md" /><span className="text-gray-800 text-xs">{BRANDS[issue.brand]?.name ?? issue.brand}</span></div></td>
                    <td className="py-4 px-5">
                      <Link href={`/admin/${issue.id}`} className="font-serif text-base text-gray-900 hover:text-[#B85D19] underline-offset-4 hover:underline focus-visible:underline">{issue.issue_label}</Link>
                      <p className="text-xs text-gray-500 mt-0.5">{issue.issue_id}</p>
                    </td>
                    <td className="py-4 px-5 whitespace-nowrap"><StatusBadge status={issue.status} brand={issue.brand} /></td>
                    <td className="py-4 px-5 tabular-nums text-gray-700">{issue.status === "review" || issue.status === "published" || issue.articleCount > 0 ? issue.articleCount : "—"}</td>
                    <td className="py-4 px-5 whitespace-nowrap text-xs text-gray-500">{issue.created_at ? new Date(issue.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"}</td>
                    <td className="py-4 px-5 whitespace-nowrap">
                      {issue.status === "review" ? (
                        <Link href={`/cms?issue=${encodeURIComponent(issue.id)}&brand=${encodeURIComponent(issue.brand)}`} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600">Review drafts <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
                      ) : (
                        <Link href={`/admin/${issue.id}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 underline underline-offset-4 hover:text-[#B85D19]">View issue <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  );
}
