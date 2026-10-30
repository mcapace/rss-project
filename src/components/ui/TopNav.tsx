"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { CorporateLogo } from "@/components/ui/CorporateLogo";

export function TopNav() {
  const pathname = usePathname();

  if (pathname.startsWith("/cms") || pathname === "/login") return null;

  const isNewIssueActive = pathname === "/admin/new";
  const isReaderActive = pathname === "/reader";

  return (
    <header className="sticky top-0 z-50 w-full bg-white/90 backdrop-blur-md border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Brand Wordmark & Corporate Logo */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <CorporateLogo height={18} linked onDark={false} />
            <span className="text-[9px] uppercase font-mono tracking-widest text-gray-500 px-1.5 py-0.5 rounded bg-gray-100 border border-gray-200">
              CMS
            </span>
          </div>

          {/* Desktop Nav Links */}
          <nav className="hidden sm:flex items-center gap-1">
            <Link
              href="/cms"
              className={`px-3 py-1.5 rounded-lg text-xs font-medium tracking-wide transition-all ${
                pathname === "/cms"
                  ? "bg-gray-100 text-gray-900 border border-gray-200 font-semibold"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              }`}
            >
              Content library
            </Link>
            <Link
              href="/admin/new"
              className={`px-3 py-1.5 rounded-lg text-xs font-medium tracking-wide transition-all ${
                isNewIssueActive
                  ? "bg-gray-100 text-gray-900 border border-gray-200 font-semibold"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              }`}
            >
              New Issue
            </Link>
            <Link
              href="/reader"
              className={`px-3 py-1.5 rounded-lg text-xs font-medium tracking-wide transition-all ${
                isReaderActive
                  ? "bg-gray-100 text-gray-900 border border-gray-200 font-semibold"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              }`}
            >
              Legacy RSS
            </Link>
          </nav>
        </div>

        {/* Action Button */}
        <div className="flex items-center gap-2">
          <Link
            href="/admin/new"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#C9A227] hover:bg-[#D8B138] text-gray-950 text-xs font-semibold tracking-tight transition-colors shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden xs:inline">New Issue</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
