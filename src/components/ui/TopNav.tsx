"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { CorporateLogo } from "@/components/ui/CorporateLogo";

export function TopNav() {
  const pathname = usePathname();

  const isIssuesActive = pathname === "/admin" || pathname.startsWith("/admin/");
  const isNewIssueActive = pathname === "/admin/new";
  const isReaderActive = pathname === "/";

  return (
    <header className="sticky top-0 z-50 w-full bg-[#0A0A0B]/90 backdrop-blur-md border-b border-[rgba(255,255,255,0.08)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Brand Wordmark & Corporate Logo */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <CorporateLogo height={16} linked onDark />
            <span className="text-[rgba(255,255,255,0.2)] text-xs font-light">|</span>
            <Link
              href="/admin"
              className="group flex items-center gap-2 text-decoration-none"
            >
              <span className="font-serif text-lg tracking-tight text-[#EDEDED] group-hover:text-white transition-colors">
                Editions
              </span>
              <span className="text-[9px] uppercase font-mono tracking-widest text-[#9A9AA0] px-1.5 py-0.5 rounded bg-[#141416] border border-[rgba(255,255,255,0.06)]">
                RSS
              </span>
            </Link>
          </div>

          {/* Desktop Nav Links */}
          <nav className="hidden sm:flex items-center gap-1">
            <Link
              href="/admin"
              className={`px-3 py-1.5 rounded-lg text-xs font-medium tracking-wide transition-all ${
                isIssuesActive && !isNewIssueActive
                  ? "bg-[#141416] text-[#EDEDED] border border-[rgba(255,255,255,0.08)]"
                  : "text-[#9A9AA0] hover:text-[#EDEDED] hover:bg-[#141416]/50"
              }`}
            >
              Issues
            </Link>
            <Link
              href="/admin/new"
              className={`px-3 py-1.5 rounded-lg text-xs font-medium tracking-wide transition-all ${
                isNewIssueActive
                  ? "bg-[#141416] text-[#EDEDED] border border-[rgba(255,255,255,0.08)]"
                  : "text-[#9A9AA0] hover:text-[#EDEDED] hover:bg-[#141416]/50"
              }`}
            >
              New Issue
            </Link>
            <Link
              href="/"
              className={`px-3 py-1.5 rounded-lg text-xs font-medium tracking-wide transition-all ${
                isReaderActive
                  ? "bg-[#141416] text-[#EDEDED] border border-[rgba(255,255,255,0.08)]"
                  : "text-[#9A9AA0] hover:text-[#EDEDED] hover:bg-[#141416]/50"
              }`}
            >
              Reader
            </Link>
          </nav>
        </div>

        {/* Action Button */}
        <div className="flex items-center gap-2">
          <Link
            href="/admin/new"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#C9A227] hover:bg-[#D8B138] text-[#0A0A0B] text-xs font-semibold tracking-tight transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden xs:inline">New Issue</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
