"use client";

import Link from "next/link";
import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Plus } from "lucide-react";
import { CorporateLogo } from "@/components/ui/CorporateLogo";
import { isCmsBrand, publicationHref, publicationNames, resolveCmsBrand } from "@/lib/cms/publications";
import type { CmsUser } from "@/lib/cms/access";

export function TopNav() {
  const pathname = usePathname();

  if (pathname.startsWith("/cms") || pathname === "/login") return null;

  return <Suspense fallback={null}><PublicationTopNav pathname={pathname} /></Suspense>;
}

async function sessionFetcher(url: string): Promise<{ user: CmsUser }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("CMS sign-in required.");
  return response.json();
}

function PublicationTopNav({ pathname }: { pathname: string }) {
  const searchParams = useSearchParams();
  const { data } = useSWR<{ user: CmsUser }>("/api/cms/session", sessionFetcher, { shouldRetryOnError: false });
  const allowedBrands = data?.user.brands.filter(isCmsBrand) || [];
  const brand = resolveCmsBrand(searchParams.get("brand"), allowedBrands);

  const isNewIssueActive = pathname === "/admin/new";
  const isReaderActive = pathname === "/reader";

  return (
    <header className="sticky top-0 z-50 w-full bg-white/90 backdrop-blur-md border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Brand Wordmark & Corporate Logo */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <Link href={publicationHref("/admin", brand)} aria-label="Open the publication's issue inbox"><CorporateLogo height={18} onDark={false} /></Link>
            <span className="text-[9px] uppercase font-mono tracking-widest text-gray-500 px-1.5 py-0.5 rounded bg-gray-100 border border-gray-200">
              CMS
            </span>
          </div>

          {/* Desktop Nav Links */}
          <nav className="hidden sm:flex items-center gap-1">
            <Link
              href={publicationHref("/cms", brand)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium tracking-wide transition-all ${
                pathname === "/cms"
                  ? "bg-gray-100 text-gray-900 border border-gray-200 font-semibold"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              }`}
            >
              Content library
            </Link>
            <Link
              href={publicationHref("/admin/new", brand)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium tracking-wide transition-all ${
                isNewIssueActive
                  ? "bg-gray-100 text-gray-900 border border-gray-200 font-semibold"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              }`}
            >
              New Issue
            </Link>
            <Link
              href={publicationHref("/reader", brand)}
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
          {brand && <span className="hidden md:inline text-xs text-gray-600 mr-2">{publicationNames[brand]}</span>}
          <Link
            href={publicationHref("/admin/new", brand)}
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
