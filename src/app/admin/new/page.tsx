"use client";

import { useState } from "react";
import Link from "next/link";
import { UploadCloud, FileText, ArrowLeft, Sparkles } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { BrandMark } from "@/components/ui/BrandMark";
import { BRANDS, BrandKey } from "@/lib/brands";

export default function NewIssuePage() {
  const [selectedBrand, setSelectedBrand] = useState<BrandKey>("mw");
  const [issueId, setIssueId] = useState("2026-09");
  const [issueLabel, setIssueLabel] = useState("September 2026");
  const [tocPages, setTocPages] = useState("3,4");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const brandList: BrandKey[] = ["mw", "ws", "ca"];
  const currentBrandConfig = BRANDS[selectedBrand];

  return (
    <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-10 space-y-8">
      {/* Back Link & Header */}
      <div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-xs text-[#9A9AA0] hover:text-[#EDEDED] transition-colors mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Issues</span>
        </Link>
        <div className="flex items-baseline justify-between">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9A9AA0]">
              Publishing Pipeline
            </span>
            <h1 className="font-serif text-3xl text-[#EDEDED] font-normal tracking-tight mt-1">
              New Issue
            </h1>
          </div>
        </div>
      </div>

      {/* Main Form Card */}
      <Card elevated padding="lg" className="space-y-8">
        {/* Brand Selector Tiles */}
        <div className="space-y-3">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[#9A9AA0]">
            Select Brand
          </label>
          <div className="grid grid-cols-3 gap-3">
            {brandList.map((key) => {
              const brand = BRANDS[key];
              const isSelected = selectedBrand === key;
              return (
                <button
                  type="button"
                  key={key}
                  onClick={() => setSelectedBrand(key)}
                  className={`p-4 rounded-xl border text-left transition-all relative flex flex-col justify-between h-28 ${
                    isSelected
                      ? "bg-[#1B1B1E] border-[rgba(255,255,255,0.25)] ring-1 ring-[#C9A227]/40 shadow-lg"
                      : "bg-[#141416] border-[rgba(255,255,255,0.08)] hover:bg-[#1B1B1E] hover:border-[rgba(255,255,255,0.16)]"
                  }`}
                >
                  <BrandMark brand={key} size="md" />
                  <div>
                    <div className="text-sm font-semibold text-[#EDEDED] tracking-tight">
                      {brand.name}
                    </div>
                    <div className="text-[11px] font-mono text-[#9A9AA0] mt-0.5">
                      {brand.short}
                    </div>
                  </div>
                  {isSelected && (
                    <span
                      className="absolute top-3 right-3 w-2 h-2 rounded-full"
                      style={{ backgroundColor: brand.accent }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Issue Identification Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#9A9AA0]">
              Issue ID
            </label>
            <input
              type="text"
              value={issueId}
              onChange={(e) => setIssueId(e.target.value)}
              placeholder="e.g. 2026-09"
              className="w-full px-3.5 py-2.5 bg-[#0A0A0B] border border-[rgba(255,255,255,0.08)] rounded-lg text-sm text-[#EDEDED] font-mono placeholder-[#6B6B72] focus:outline-none focus:border-[#C9A227] focus:ring-1 focus:ring-[#C9A227]"
            />
            <p className="text-[11px] text-[#6B6B72]">
              Folder / URL identifier (YYYY-MM)
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#9A9AA0]">
              Issue Label
            </label>
            <input
              type="text"
              value={issueLabel}
              onChange={(e) => setIssueLabel(e.target.value)}
              placeholder="e.g. September 2026"
              className="w-full px-3.5 py-2.5 bg-[#0A0A0B] border border-[rgba(255,255,255,0.08)] rounded-lg text-sm text-[#EDEDED] font-serif placeholder-[#6B6B72] focus:outline-none focus:border-[#C9A227] focus:ring-1 focus:ring-[#C9A227]"
            />
            <p className="text-[11px] text-[#6B6B72]">
              Human-readable title displayed in feeds
            </p>
          </div>
        </div>

        {/* Table of Contents Pages */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[#9A9AA0]">
            TOC Pages
          </label>
          <input
            type="text"
            value={tocPages}
            onChange={(e) => setTocPages(e.target.value)}
            placeholder="3,4"
            className="w-full px-3.5 py-2.5 bg-[#0A0A0B] border border-[rgba(255,255,255,0.08)] rounded-lg text-sm text-[#EDEDED] font-mono placeholder-[#6B6B72] focus:outline-none focus:border-[#C9A227] focus:ring-1 focus:ring-[#C9A227]"
          />
          <p className="text-[11px] text-[#6B6B72]">
            Printed pages holding the table of contents (comma-separated, e.g. 3,4)
          </p>
        </div>

        {/* PDF Dropzone */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[#9A9AA0]">
            Print-Production PDF
          </label>
          <div className="border border-dashed border-[rgba(255,255,255,0.12)] hover:border-[rgba(255,255,255,0.24)] rounded-xl p-8 text-center bg-[#0A0A0B]/60 transition-colors cursor-pointer group">
            <UploadCloud className="w-8 h-8 mx-auto text-[#9A9AA0] group-hover:text-[#EDEDED] transition-colors mb-3" />
            <div className="text-sm font-medium text-[#EDEDED]">
              {selectedFile ? (
                <span className="text-[#C9A227]">{selectedFile.name}</span>
              ) : (
                "Drop print-ready PDF here, or browse"
              )}
            </div>
            <p className="text-xs text-[#6B6B72] mt-1 font-mono">
              Accepts .pdf up to 500MB • Direct S3 upload
            </p>
          </div>
        </div>

        {/* Action Button */}
        <div className="pt-2 flex items-center justify-end gap-3 border-t border-[rgba(255,255,255,0.06)]">
          <Link href="/admin">
            <Button variant="ghost" size="md">
              Cancel
            </Button>
          </Link>
          <Button variant="primary" size="md">
            <Sparkles className="w-4 h-4 mr-1.5" />
            Start Processing (Step 3)
          </Button>
        </div>
      </Card>
    </main>
  );
}
