"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  Plus,
  Copy,
  Check,
  ArrowRight,
  RefreshCw,
  FolderOpen,
  Sparkles,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { BrandMark } from "@/components/ui/BrandMark";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { BRANDS, BrandKey } from "@/lib/brands";

interface IssueItem {
  id: string;
  brand: string;
  issue_id: string;
  issue_label: string;
  pdf_key: string;
  status: string;
  articleCount: number;
  created_at: string;
  feedUrl: string;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || "Failed to fetch issues");
  }
  return data;
};

export default function AdminIssuesPage() {
  const router = useRouter();
  const [selectedBrandFilter, setSelectedBrandFilter] = useState<string>("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Poll with SWR every 10s so statuses update live
  const { data, error, isLoading, isValidating } = useSWR(
    "/api/issues",
    fetcher,
    {
      refreshInterval: 10000,
      revalidateOnFocus: true,
    }
  );

  const issues: IssueItem[] = data?.issues || [];

  const handleCopyFeed = (e: React.MouseEvent, issue: IssueItem) => {
    e.stopPropagation();
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const fullUrl = `${origin}${issue.feedUrl}`;
    navigator.clipboard.writeText(fullUrl);
    setCopiedId(issue.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredIssues = issues.filter((issue) => {
    if (selectedBrandFilter === "all") return true;
    return issue.brand.toLowerCase() === selectedBrandFilter.toLowerCase();
  });

  const filterTabs: Array<{ id: string; label: string; brandKey?: BrandKey }> = [
    { id: "all", label: "All Brands" },
    { id: "mw", label: "MW", brandKey: "mw" },
    { id: "ws", label: "WS", brandKey: "ws" },
    { id: "ca", label: "CA", brandKey: "ca" },
  ];

  return (
    <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-10 space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-2 border-b border-[rgba(255,255,255,0.06)]">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9A9AA0]">
            Digital Editions • Management
          </span>
          <h1 className="font-serif text-3xl sm:text-4xl text-[#EDEDED] font-normal tracking-tight mt-1">
            Issues
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/admin/new">
            <Button variant="primary" size="md">
              <Plus className="w-4 h-4 mr-1.5" />
              New Issue
            </Button>
          </Link>
        </div>
      </div>

      {/* Brand Filter Tabs & Live Status */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {filterTabs.map((tab) => {
            const isSelected = selectedBrandFilter === tab.id;
            const brandConfig = tab.brandKey ? BRANDS[tab.brandKey] : undefined;

            return (
              <button
                key={tab.id}
                onClick={() => setSelectedBrandFilter(tab.id)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-medium tracking-wide transition-all flex items-center gap-2 ${
                  isSelected
                    ? "bg-[#141416] text-[#EDEDED] border border-[rgba(255,255,255,0.16)] shadow-sm"
                    : "text-[#9A9AA0] hover:text-[#EDEDED] bg-transparent hover:bg-[#141416] border border-transparent hover:border-[rgba(255,255,255,0.08)]"
                }`}
              >
                {brandConfig && (
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: brandConfig.accent }}
                  />
                )}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Live SWR Indicator */}
        <div className="hidden sm:flex items-center gap-2 text-[11px] font-mono text-[#9A9AA0]">
          <RefreshCw
            className={`w-3 h-3 text-[#C9A227] ${
              isValidating ? "animate-spin" : "opacity-40"
            }`}
          />
          <span>10s SWR</span>
        </div>
      </div>

      {/* Issues Table Card */}
      <Card padding="none" className="overflow-hidden">
        {isLoading && issues.length === 0 ? (
          <div className="py-24 text-center space-y-3">
            <RefreshCw className="w-7 h-7 animate-spin mx-auto text-[#C9A227]" />
            <p className="text-xs font-mono text-[#9A9AA0]">
              Loading edition catalog...
            </p>
          </div>
        ) : filteredIssues.length === 0 ? (
          /* Empty State */
          <div className="py-24 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-[#1B1B1E] border border-[rgba(255,255,255,0.08)] flex items-center justify-center mx-auto text-[#9A9AA0]">
              <FolderOpen className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="font-serif text-2xl text-[#EDEDED] font-normal">
                No issues yet
              </h3>
              <p className="text-xs text-[#9A9AA0] max-w-sm mx-auto">
                Upload your first print-production PDF to begin automated BlueToad replacement.
              </p>
            </div>
            <div className="pt-2">
              <Link href="/admin/new">
                <Button variant="primary" size="md">
                  <Sparkles className="w-4 h-4 mr-1.5" />
                  New Issue
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          /* Table View */
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[rgba(255,255,255,0.08)] bg-[#1B1B1E]/40 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#9A9AA0]">
                  <th className="py-3.5 px-6 font-medium">Brand</th>
                  <th className="py-3.5 px-6 font-medium">Issue</th>
                  <th className="py-3.5 px-6 font-medium">Status</th>
                  <th className="py-3.5 px-6 font-medium">Articles</th>
                  <th className="py-3.5 px-6 font-medium">Created</th>
                  <th className="py-3.5 px-6 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(255,255,255,0.04)] text-sm">
                {filteredIssues.map((issue) => (
                  <tr
                    key={issue.id}
                    onClick={() => router.push(`/admin/${issue.id}`)}
                    className="hover:bg-[#1B1B1E]/60 transition-colors group cursor-pointer"
                  >
                    <td className="py-4 px-6 whitespace-nowrap">
                      <BrandMark brand={issue.brand} size="md" showName />
                    </td>
                    <td className="py-4 px-6 whitespace-nowrap">
                      <div className="font-serif text-base text-[#EDEDED] font-normal group-hover:text-white transition-colors">
                        {issue.issue_label}
                      </div>
                      <div className="text-xs font-mono text-[#9A9AA0]">
                        {issue.issue_id}
                      </div>
                    </td>
                    <td className="py-4 px-6 whitespace-nowrap">
                      <StatusBadge status={issue.status} brand={issue.brand} />
                    </td>
                    <td className="py-4 px-6 whitespace-nowrap font-mono text-xs text-[#9A9AA0]">
                      {issue.status === "published" ? (
                        <span className="text-[#EDEDED] font-semibold">
                          {issue.articleCount}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-4 px-6 whitespace-nowrap text-xs font-mono text-[#9A9AA0]">
                      {issue.created_at
                        ? new Date(issue.created_at).toLocaleDateString(
                            undefined,
                            {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            }
                          )
                        : "—"}
                    </td>
                    <td className="py-4 px-6 whitespace-nowrap text-right text-xs">
                      <div className="inline-flex items-center gap-2">
                        {issue.status === "published" && (
                          <button
                            type="button"
                            onClick={(e) => handleCopyFeed(e, issue)}
                            title="Copy Public Feed URL"
                            className="px-2.5 py-1 rounded bg-[#1B1B1E] hover:bg-[#25252A] text-[#9A9AA0] hover:text-[#EDEDED] font-mono text-[11px] border border-[rgba(255,255,255,0.08)] flex items-center gap-1.5 transition-colors"
                          >
                            {copiedId === issue.id ? (
                              <>
                                <Check className="w-3 h-3 text-[#4ADE80]" />
                                <span className="text-[#4ADE80]">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Copy Feed URL</span>
                              </>
                            )}
                          </button>
                        )}
                        <span className="p-1.5 text-[#9A9AA0] group-hover:text-[#EDEDED] transition-colors">
                          <ArrowRight className="w-4 h-4" />
                        </span>
                      </div>
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
