"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  UploadCloud,
  FileText,
  ArrowLeft,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { BrandMark } from "@/components/ui/BrandMark";
import { BRANDS, BrandKey } from "@/lib/brands";

export default function NewIssuePage() {
  const router = useRouter();

  const [selectedBrand, setSelectedBrand] = useState<BrandKey>("mw");
  const [issueId, setIssueId] = useState("2026-09");
  const [issueLabel, setIssueLabel] = useState("September 2026");
  const [tocPages, setTocPages] = useState("3,4");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Upload states
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState<
    "idle" | "requesting_url" | "uploading_s3" | "triggering_process" | "done"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const brandList: BrandKey[] = ["mw", "ws", "ca"];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.type !== "application/pdf" && !file.name.endsWith(".pdf")) {
        setErrorMessage("Please select a valid PDF file.");
        return;
      }
      if (file.size > 500 * 1024 * 1024) {
        setErrorMessage("PDF file size exceeds maximum limit of 500MB.");
        return;
      }
      setErrorMessage(null);
      setSelectedFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type !== "application/pdf" && !file.name.endsWith(".pdf")) {
        setErrorMessage("Please select a valid PDF file.");
        return;
      }
      if (file.size > 500 * 1024 * 1024) {
        setErrorMessage("PDF file size exceeds maximum limit of 500MB.");
        return;
      }
      setErrorMessage(null);
      setSelectedFile(file);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + " KB";
    }
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setErrorMessage("Please select a PDF file to upload.");
      return;
    }
    if (!issueId.trim() || !issueLabel.trim()) {
      setErrorMessage("Issue ID and Issue Label are required.");
      return;
    }

    setIsUploading(true);
    setErrorMessage(null);
    setUploadProgress(0);

    try {
      // Step 1: Request presigned S3 PUT URL
      setUploadStage("requesting_url");
      const urlRes = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand: selectedBrand,
          issueId: issueId.trim(),
          filename: selectedFile.name,
        }),
      });

      const urlData = await urlRes.json();
      if (!urlRes.ok || urlData.error) {
        throw new Error(urlData.error || "Failed to generate S3 upload URL");
      }

      const { uploadUrl, pdfKey } = urlData;

      // Step 2: Upload directly to S3 using XMLHttpRequest for progress tracking
      setUploadStage("uploading_s3");
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl, true);
        xhr.setRequestHeader("Content-Type", "application/pdf");

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percentComplete = Math.round(
              (event.loaded / event.total) * 100
            );
            setUploadProgress(percentComplete);
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(
              new Error(
                `S3 upload failed with status ${xhr.status} ${xhr.statusText}. Ensure S3 CORS permits PUT from this domain.`
              )
            );
          }
        };

        xhr.onerror = () => {
          reject(
            new Error(
              "Network error during direct S3 upload. Check AWS S3 bucket CORS permissions."
            )
          );
        };

        xhr.send(selectedFile);
      });

      // Step 3: Trigger backend processing and redirect
      setUploadStage("triggering_process");
      const procRes = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand: selectedBrand,
          issueId: issueId.trim(),
          issueLabel: issueLabel.trim(),
          tocPages: tocPages.trim(),
          pdfKey,
        }),
      });

      const procData = await procRes.json();
      if (!procRes.ok || procData.error) {
        throw new Error(procData.error || "Failed to register issue in database");
      }

      setUploadStage("done");
      const targetUuid = procData.issueUuid;
      router.push(`/admin/${targetUuid}`);
    } catch (err: any) {
      console.error("Upload workflow failed:", err);
      setErrorMessage(
        err.message || "An unexpected error occurred during the upload process."
      );
      setIsUploading(false);
      setUploadStage("idle");
    }
  };

  return (
    <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-10 space-y-8">
      {/* Back Link & Header */}
      <div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 transition-colors mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Issues</span>
        </Link>
        <div className="flex items-baseline justify-between">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-500">
              Publishing Pipeline
            </span>
            <h1 className="font-serif text-3xl text-gray-900 font-normal tracking-tight mt-1">
              New Issue
            </h1>
          </div>
        </div>
      </div>

      {/* Main Form Card */}
      <Card elevated padding="lg" className="space-y-8">
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Brand Selector Tiles */}
          <div className="space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600">
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
                    disabled={isUploading}
                    onClick={() => setSelectedBrand(key)}
                    className={`p-4 rounded-xl border text-left transition-all relative flex flex-col justify-between h-28 ${
                      isSelected
                        ? "bg-amber-50/50 border-amber-500 ring-1 ring-amber-500/40 shadow-xs"
                        : "bg-white border-gray-200 hover:bg-gray-50 hover:border-gray-300"
                    }`}
                  >
                    <BrandMark brand={key} size="md" />
                    <div>
                      <div className="text-sm font-semibold text-gray-900 tracking-tight">
                        {brand.name}
                      </div>
                      <div className="text-[11px] font-mono text-gray-500 mt-0.5">
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
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600">
                Issue ID
              </label>
              <input
                type="text"
                disabled={isUploading}
                value={issueId}
                onChange={(e) => setIssueId(e.target.value)}
                placeholder="e.g. 2026-09"
                required
                className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 font-mono placeholder-gray-400 focus:outline-none focus:border-[#C9A227] focus:ring-1 focus:ring-[#C9A227] disabled:opacity-50"
              />
              <p className="text-[11px] text-gray-500">
                Folder / URL identifier (YYYY-MM)
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600">
                Issue Label
              </label>
              <input
                type="text"
                disabled={isUploading}
                value={issueLabel}
                onChange={(e) => setIssueLabel(e.target.value)}
                placeholder="e.g. September 2026"
                required
                className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 font-serif placeholder-gray-400 focus:outline-none focus:border-[#C9A227] focus:ring-1 focus:ring-[#C9A227] disabled:opacity-50"
              />
              <p className="text-[11px] text-gray-500">
                Human-readable title displayed in feeds
              </p>
            </div>
          </div>

          {/* Table of Contents Pages */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600">
              TOC Pages
            </label>
            <input
              type="text"
              disabled={isUploading}
              value={tocPages}
              onChange={(e) => setTocPages(e.target.value)}
              placeholder="3,4"
              className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 font-mono placeholder-gray-400 focus:outline-none focus:border-[#C9A227] focus:ring-1 focus:ring-[#C9A227] disabled:opacity-50"
            />
            <p className="text-[11px] text-gray-500">
              Printed pages holding the table of contents (comma-separated, default &quot;3,4&quot;)
            </p>
          </div>

          {/* PDF Dropzone */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600">
              Print-Production PDF
            </label>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="application/pdf,.pdf"
              className="hidden"
            />

            {!selectedFile ? (
              <div
                onClick={() => !isUploading && fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                className="border border-dashed border-gray-300 hover:border-gray-400 rounded-xl p-8 text-center bg-gray-50/70 transition-colors cursor-pointer group"
              >
                <UploadCloud className="w-8 h-8 mx-auto text-gray-400 group-hover:text-gray-700 transition-colors mb-3" />
                <div className="text-sm font-medium text-gray-800">
                  Drop print-ready PDF here, or browse
                </div>
                <p className="text-xs text-gray-500 mt-1 font-mono">
                  Accepts .pdf up to 500MB • Direct S3 upload
                </p>
              </div>
            ) : (
              <div className="border border-gray-200 bg-white rounded-xl p-4 flex items-center justify-between shadow-xs">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-[#C9A227] shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="overflow-hidden">
                    <div className="text-sm font-medium text-gray-900 truncate font-mono">
                      {selectedFile.name}
                    </div>
                    <div className="text-xs text-gray-500 font-mono mt-0.5">
                      {formatFileSize(selectedFile.size)}
                    </div>
                  </div>
                </div>

                {!isUploading && (
                  <button
                    type="button"
                    onClick={() => setSelectedFile(null)}
                    className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg bg-gray-100 hover:bg-gray-200 border border-gray-200 ml-3 shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Upload Progress Bar */}
          {isUploading && (
            <div className="space-y-2 p-4 rounded-xl bg-gray-50 border border-gray-200">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-gray-900 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#C9A227] animate-pulse" />
                  {uploadStage === "requesting_url" && "Requesting presigned upload URL..."}
                  {uploadStage === "uploading_s3" && `Uploading PDF to S3 inbox (${uploadProgress}%)...`}
                  {uploadStage === "triggering_process" && "Registering issue & triggering pipeline..."}
                  {uploadStage === "done" && "Upload complete! Redirecting..."}
                </span>
                <span className="font-mono text-[#C9A227] font-semibold">
                  {uploadProgress}%
                </span>
              </div>

              {/* Gold Progress Bar */}
              <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#C9A227] to-[#E5BE43] transition-all duration-150 ease-out"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Inline Error Banner */}
          {errorMessage && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 flex items-start gap-3">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="text-xs space-y-0.5">
                <strong className="font-semibold">Upload failure:</strong>
                <p className="text-red-600">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Submit Actions */}
          <div className="pt-2 flex items-center justify-end gap-3 border-t border-gray-100">
            <Link href="/admin">
              <Button type="button" variant="ghost" size="md" disabled={isUploading}>
                Cancel
              </Button>
            </Link>
            <Button
              type="submit"
              variant="primary"
              size="md"
              isLoading={isUploading}
              disabled={isUploading || !selectedFile}
            >
              <Sparkles className="w-4 h-4 mr-1.5" />
              {isUploading ? "Uploading..." : "Start Processing"}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
