"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { AlertCircle, ArrowLeft, FileText, Sparkles, UploadCloud, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { BrandMark } from "@/components/ui/BrandMark";
import { BRANDS } from "@/lib/brands";
import { publicationHref, resolveCmsBrand } from "@/lib/cms/publications";
import { CMS_BRANDS, type CmsBrand } from "@/lib/cms/types";

interface SessionResponse { user: { brands: CmsBrand[] } }
interface UploadResponse { uploadUrl: string; pdfKey: string; uploadHeaders: Record<string, string>; error?: string }
const brandOptions = CMS_BRANDS.map((brand) => BRANDS[brand]);
const inputClass = "w-full px-3.5 py-2.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600 disabled:opacity-50";

async function fetchSession(url: string): Promise<SessionResponse> {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || "Could not load your publication access.");
  return data;
}

export default function NewIssuePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedBrand = searchParams.get("brand");
  const { data: session, error: sessionError, mutate: refreshSession } = useSWR<SessionResponse, Error>("/api/cms/session", fetchSession);
  const availableBrands = brandOptions.filter((brand) => session?.user.brands.includes(brand.id));
  const selectedBrand = resolveCmsBrand(requestedBrand, availableBrands.map((brand) => brand.id));
  const issuesUrl = publicationHref("/admin", selectedBrand);
  const [issueId, setIssueId] = useState("");
  const [issueLabel, setIssueLabel] = useState("");
  const [tocPages, setTocPages] = useState("3,4");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState<"idle" | "preparing" | "uploading" | "extracting" | "done">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectedBrand && !sessionError && requestedBrand !== selectedBrand) {
      window.history.replaceState(null, "", publicationHref("/admin/new", selectedBrand));
    }
  }, [requestedBrand, selectedBrand, sessionError]);

  function changePublication(brand: CmsBrand) {
    if (isUploading || !availableBrands.some((option) => option.id === brand)) return;
    window.history.replaceState(null, "", publicationHref("/admin/new", brand));
  }

  function selectFile(file?: File) {
    if (!file || isUploading) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setSelectedFile(null);
      setErrorMessage("Please choose a PDF file.");
      return;
    }
    if (file.size === 0 || file.size > 500 * 1024 * 1024) {
      setSelectedFile(null);
      setErrorMessage("Choose a PDF larger than 0 bytes and no larger than 500 MB.");
      return;
    }
    setErrorMessage(null);
    setSelectedFile(file);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isUploading) return;
    const cleanId = issueId.trim();
    const cleanLabel = issueLabel.trim();
    const pageStrings = tocPages.split(",").map((page) => page.trim());
    if (!availableBrands.some((brand) => brand.id === selectedBrand)) { setErrorMessage("Choose a publication you can edit."); return; }
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(cleanId)) { setErrorMessage("Issue ID must be 1–80 letters, numbers, hyphens, or underscores, starting with a letter or number."); return; }
    if (!cleanLabel || cleanLabel.length > 200) { setErrorMessage("Enter an issue name of 1–200 characters."); return; }
    if (pageStrings.length > 20 || pageStrings.some((page) => !/^[1-9]\d*$/.test(page) || Number(page) > 2000)) { setErrorMessage("Enter up to 20 table of contents PDF page numbers from 1 to 2000, separated by commas."); return; }
    if (!selectedFile) { setErrorMessage("Choose the issue PDF before continuing."); return; }

    setIsUploading(true);
    setErrorMessage(null);
    setUploadProgress(0);
    try {
      setUploadStage("preparing");
      const uploadResponse = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand: selectedBrand, issueId: cleanId, filename: selectedFile.name }),
      });
      const upload: UploadResponse = await uploadResponse.json();
      if (!uploadResponse.ok || upload.error) throw new Error(upload.error || "Could not prepare this upload.");
      if (!upload.uploadUrl || !upload.pdfKey || !upload.uploadHeaders) throw new Error("The upload could not be prepared. Please try again.");

      setUploadStage("uploading");
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", upload.uploadUrl, true);
        xhr.timeout = 15 * 60 * 1000;
        // Every signed header is part of the upload contract, including the overwrite guard.
        for (const [name, value] of Object.entries(upload.uploadHeaders)) xhr.setRequestHeader(name, value);
        xhr.upload.onprogress = (progress) => {
          if (progress.lengthComputable) setUploadProgress(Math.round((progress.loaded / progress.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) { setUploadProgress(100); resolve(); }
          else reject(new Error("The PDF upload was not accepted. Please try again."));
        };
        xhr.onerror = () => reject(new Error("The PDF upload could not finish. Check your connection and try again."));
        xhr.ontimeout = () => reject(new Error("The upload took too long. Check your connection and try again."));
        xhr.onabort = () => reject(new Error("The PDF upload was interrupted. Please try again."));
        xhr.send(selectedFile);
      });

      setUploadStage("extracting");
      const processResponse = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand: selectedBrand, issueId: cleanId, issueLabel: cleanLabel, tocPages: [...new Set(pageStrings.map(Number))].sort((a, b) => a - b).join(","), pdfKey: upload.pdfKey }),
      });
      const result = await processResponse.json();
      if (!processResponse.ok || result.error) throw new Error(result.error || "The PDF uploaded, but extraction could not start.");
      if (typeof result.issueUuid !== "string" || !result.issueUuid) throw new Error("The issue could not be opened. Check the issue list before trying again.");
      setUploadStage("done");
      router.push(publicationHref(`/admin/${encodeURIComponent(result.issueUuid)}`, selectedBrand));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Something went wrong. Please try again.");
      setIsUploading(false);
      setUploadStage("idle");
    }
  }

  return (
    <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-10 space-y-7">
      <div>
        <Link href={issuesUrl} className="inline-flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900 mb-4"><ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Back to issues</Link>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-500">Print to web</p>
        <h1 className="font-serif text-3xl text-gray-900 mt-1">New print issue</h1>
        <p className="text-sm text-gray-600 mt-2">Upload the issue PDF to prepare articles and images for editorial review.</p>
      </div>

      {sessionError && <div role="alert" className="p-4 rounded-xl border border-red-200 bg-red-50 text-sm text-red-800"><p>{sessionError.message}</p><Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void refreshSession()}>Reload access</Button></div>}

      <Card elevated padding="lg">
        <form onSubmit={handleSubmit} className="space-y-7">
          <fieldset disabled={isUploading || !session || !!sessionError} className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-wider text-gray-600">Publication</legend>
            {!session && !sessionError && <p className="text-sm text-gray-500" role="status">Loading publications…</p>}
            {session && availableBrands.length === 0 && <p role="alert" className="text-sm text-red-700">Your account has no publication access. Ask your CMS administrator to assign a publication.</p>}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {availableBrands.map((brand) => (
                <button key={brand.id} type="button" aria-pressed={selectedBrand === brand.id} onClick={() => changePublication(brand.id)} className={`p-3 rounded-xl border text-left h-28 flex flex-col justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:opacity-50 ${selectedBrand === brand.id ? "bg-amber-50 border-amber-600 shadow-xs" : "bg-white border-gray-200 hover:bg-gray-50"}`}>
                  <BrandMark brand={brand.id} size="md" />
                  <span className="text-xs font-semibold text-gray-900">{brand.name}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="space-y-2">
              <label htmlFor="issue-id" className="block text-xs font-semibold text-gray-700">Issue ID</label>
              <input id="issue-id" type="text" value={issueId} onChange={(event) => setIssueId(event.target.value)} disabled={isUploading} placeholder="e.g. fall-2026" maxLength={80} required aria-describedby="issue-id-help" className={inputClass} />
              <p id="issue-id-help" className="text-xs text-gray-500">A stable reference using letters, numbers, hyphens, or underscores. Reuse it when re-extracting this issue.</p>
            </div>
            <div className="space-y-2">
              <label htmlFor="issue-name" className="block text-xs font-semibold text-gray-700">Issue name</label>
              <input id="issue-name" type="text" value={issueLabel} onChange={(event) => setIssueLabel(event.target.value)} disabled={isUploading} placeholder="e.g. Fall 2026" maxLength={200} required aria-describedby="issue-name-help" className={inputClass} />
              <p id="issue-name-help" className="text-xs text-gray-500">The name editors will see in the CMS.</p>
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="toc-pages" className="block text-xs font-semibold text-gray-700">Table of contents pages</label>
            <input id="toc-pages" type="text" value={tocPages} onChange={(event) => setTocPages(event.target.value)} disabled={isUploading} placeholder="3,4" required aria-describedby="toc-pages-help" className={inputClass} />
            <p id="toc-pages-help" className="text-xs text-gray-500">PDF page numbers containing the table of contents, separated by commas. Count the cover as page 1; these may differ from printed page numbers.</p>
          </div>

          <div className="space-y-2">
            <label htmlFor="issue-pdf" className="block text-xs font-semibold text-gray-700">Issue PDF</label>
            <input id="issue-pdf" type="file" ref={fileInputRef} accept="application/pdf,.pdf" disabled={isUploading} onChange={(event) => selectFile(event.target.files?.[0])} className="sr-only" tabIndex={-1} />
            {!selectedFile ? (
              <button type="button" disabled={isUploading} onClick={() => fileInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); selectFile(event.dataTransfer.files?.[0]); }} className="w-full border border-dashed border-gray-300 hover:border-amber-600 rounded-xl p-8 text-center bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600">
                <UploadCloud className="w-8 h-8 mx-auto text-gray-400 mb-3" aria-hidden="true" />
                <span className="block text-sm font-medium text-gray-800">Drop a PDF here, or choose a file</span>
                <span className="block text-xs text-gray-500 mt-1">PDF files up to 500 MB</span>
              </button>
            ) : (
              <div className="border border-gray-200 rounded-xl p-4 flex items-center gap-3">
                <FileText className="w-6 h-6 shrink-0 text-[#B85D19]" aria-hidden="true" />
                <div className="min-w-0 flex-1"><p className="text-sm font-medium text-gray-900 break-all">{selectedFile.name}</p><p className="text-xs text-gray-500 mt-1">{(selectedFile.size / (1024 * 1024)).toFixed(1)} MB</p></div>
                <button type="button" disabled={isUploading} aria-label="Remove selected PDF" onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-amber-600 disabled:opacity-40"><X className="w-4 h-4" aria-hidden="true" /></button>
              </div>
            )}
          </div>

          <p className="rounded-xl bg-amber-50 border border-amber-100 p-4 text-sm text-amber-950">Extracted articles enter the CMS for review. Editors check the text, bylines, images, and extraction notes before publishing. Re-extraction preserves saved editorial changes.</p>

          {isUploading && (
            <div className="space-y-3 p-4 rounded-xl bg-gray-50 border border-gray-200">
              <p className="text-sm font-medium text-gray-900" role="status" aria-live="polite">{uploadStage === "preparing" ? "Preparing upload…" : uploadStage === "uploading" ? `Uploading PDF: ${uploadProgress}%` : uploadStage === "extracting" ? "Starting extraction…" : "Opening the issue…"}</p>
              {uploadStage === "uploading" && <progress aria-label="PDF upload progress" value={uploadProgress} max={100} className="w-full h-2 accent-amber-700" />}
              <p className="text-xs text-gray-500">Keep this page open until the upload finishes.</p>
            </div>
          )}

          {errorMessage && <div role="alert" className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 flex items-start gap-3"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" /><p className="text-sm">{errorMessage}</p></div>}

          <div className="pt-5 flex items-center justify-end gap-3 border-t border-gray-100">
            <Button type="button" variant="ghost" disabled={isUploading} onClick={() => router.push(issuesUrl)}>Cancel</Button>
            <Button type="submit" variant="brand" brand={selectedBrand} isLoading={isUploading} disabled={isUploading || !selectedFile || !session || !!sessionError || availableBrands.length === 0}>
              <Sparkles className="w-4 h-4" aria-hidden="true" /> {isUploading ? "Preparing issue…" : "Upload & extract"}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
