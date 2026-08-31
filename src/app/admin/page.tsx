import Link from "next/link";
import { Plus, Copy, ExternalLink, ArrowRight } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { BrandMark } from "@/components/ui/BrandMark";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { BRANDS } from "@/lib/brands";

// Placeholder mock data demonstrating the visual design system for Step 1
const PLACEHOLDER_ISSUES = [
  {
    id: "mw-2026-09",
    brand: "mw",
    issueId: "2026-09",
    issueLabel: "September 2026",
    status: "published",
    articleCount: 18,
    createdAt: "Aug 31, 2026",
    feedUrl: "/api/feeds/mw/2026-09/feed.xml",
  },
  {
    id: "ws-2026-10",
    brand: "ws",
    issueId: "2026-10",
    issueLabel: "October 31, 2026",
    status: "processing",
    articleCount: 0,
    createdAt: "Aug 31, 2026",
    feedUrl: "/api/feeds/ws/2026-10/feed.xml",
  },
  {
    id: "ca-2026-08",
    brand: "ca",
    issueId: "2026-08",
    issueLabel: "August 2026",
    status: "queued",
    articleCount: 0,
    createdAt: "Aug 30, 2026",
    feedUrl: "/api/feeds/ca/2026-08/feed.xml",
  },
];

export default function AdminIssuesPage() {
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

      {/* Brand Filters */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <button className="px-3.5 py-1.5 rounded-lg text-xs font-medium tracking-wide bg-[#141416] text-[#EDEDED] border border-[rgba(255,255,255,0.12)]">
          All Brands
        </button>
        {Object.values(BRANDS).slice(0, 3).map((brand) => (
          <button
            key={brand.id}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium tracking-wide text-[#9A9AA0] hover:text-[#EDEDED] bg-transparent hover:bg-[#141416] border border-transparent hover:border-[rgba(255,255,255,0.08)] flex items-center gap-2"
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: brand.accent }}
            />
            {brand.short}
          </button>
        ))}
      </div>

      {/* Issues Table Card */}
      <Card padding="none" className="overflow-hidden">
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
              {PLACEHOLDER_ISSUES.map((issue) => (
                <tr
                  key={issue.id}
                  className="hover:bg-[#1B1B1E]/60 transition-colors group cursor-pointer"
                >
                  <td className="py-4 px-6 whitespace-nowrap">
                    <BrandMark brand={issue.brand} size="md" showName />
                  </td>
                  <td className="py-4 px-6 whitespace-nowrap">
                    <div className="font-serif text-base text-[#EDEDED] font-normal group-hover:text-white">
                      {issue.issueLabel}
                    </div>
                    <div className="text-xs font-mono text-[#9A9AA0]">
                      {issue.issueId}
                    </div>
                  </td>
                  <td className="py-4 px-6 whitespace-nowrap">
                    <StatusBadge status={issue.status} brand={issue.brand} />
                  </td>
                  <td className="py-4 px-6 whitespace-nowrap font-mono text-xs text-[#9A9AA0]">
                    {issue.status === "published" ? (
                      <span className="text-[#EDEDED]">{issue.articleCount}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-4 px-6 whitespace-nowrap text-xs text-[#9A9AA0]">
                    {issue.createdAt}
                  </td>
                  <td className="py-4 px-6 whitespace-nowrap text-right text-xs">
                    <div className="inline-flex items-center gap-2">
                      {issue.status === "published" && (
                        <button
                          title="Copy Feed URL"
                          className="px-2.5 py-1 rounded bg-[#1B1B1E] hover:bg-[#25252A] text-[#9A9AA0] hover:text-[#EDEDED] font-mono text-[11px] border border-[rgba(255,255,255,0.08)] flex items-center gap-1.5"
                        >
                          <Copy className="w-3 h-3" />
                          <span>Copy Feed</span>
                        </button>
                      )}
                      <Link
                        href={`/admin/${issue.id}`}
                        className="p-1.5 text-[#9A9AA0] hover:text-[#EDEDED] transition-colors"
                      >
                        <ArrowRight className="w-4 h-4" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </main>
  );
}
