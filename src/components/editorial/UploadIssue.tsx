"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileInput, FileText, Plus, Sparkles, UploadCloud, X } from "lucide-react";
import { BRAND_NAMES } from "@/lib/editorial/helpers";
import type { CmsBrand } from "@/lib/cms/types";
import { useEditorial } from "./EditorialProvider";
import { PublicationLogo } from "./Sidebar";
import { Button, Card, Field, LinkButton, Notice, PageHeader } from "./ui";

interface UploadResponse { uploadUrl: string; pdfKey: string; uploadHeaders: Record<string, string>; error?: string }
type Stage = "idle" | "preparing" | "uploading" | "extracting" | "done";

const LOGO_HEIGHT: Record<string, number> = { ws: 15, wa: 19, ca: 13, mw: 9 };
const MAX_BYTES = 500 * 1024 * 1024;

/** Upload a production PDF; the worker extracts articles and images for review. */
export function UploadIssue() {
  const router = useRouter();
  const { brand, brands, setBrand, demo, href } = useEditorial();
  const [issueId, setIssueId] = useState("");
  const [issueLabel, setIssueLabel] = useState("");
  const [tocPages, setTocPages] = useState("3,4");
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = stage !== "idle";
  const locked = busy || demo;

  function selectFile(next?: File) {
    if (!next || busy) return;
    if (next.type !== "application/pdf" && !next.name.toLowerCase().endsWith(".pdf")) { setFile(null); setError("Choose a PDF file."); return; }
    if (next.size === 0 || next.size > MAX_BYTES) { setFile(null); setError("Choose a PDF larger than 0 bytes and no larger than 500 MB."); return; }
    setError(null); setFile(next);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    const cleanId = issueId.trim();
    const cleanLabel = issueLabel.trim();
    const pages = tocPages.split(",").map(page => page.trim());
    if (!brands.includes(brand)) { setError("Choose a publication you can edit."); return; }
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(cleanId)) { setError("The issue ID must be 1–80 letters, numbers, hyphens or underscores, starting with a letter or number."); return; }
    if (!cleanLabel || cleanLabel.length > 200) { setError("Enter an issue name of 1–200 characters."); return; }
    if (pages.length > 20 || pages.some(page => !/^[1-9]\d*$/.test(page) || Number(page) > 2000)) { setError("Enter up to 20 table-of-contents PDF page numbers from 1 to 2000, separated by commas."); return; }
    if (!file) { setError("Choose the issue PDF before continuing."); return; }

    setError(null); setProgress(0);
    try {
      setStage("preparing");
      const prepared = await fetch("/api/upload-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand, issueId: cleanId, filename: file.name }) });
      const upload: UploadResponse = await prepared.json();
      if (!prepared.ok || upload.error) throw new Error(upload.error || "The upload could not be prepared.");
      if (!upload.uploadUrl || !upload.pdfKey || !upload.uploadHeaders) throw new Error("The upload could not be prepared. Please try again.");

      setStage("uploading");
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", upload.uploadUrl, true);
        xhr.timeout = 15 * 60 * 1000;
        // Every signed header is part of the upload contract, including the overwrite guard.
        for (const [name, value] of Object.entries(upload.uploadHeaders)) xhr.setRequestHeader(name, value);
        xhr.upload.onprogress = event => { if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100)); };
        xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) { setProgress(100); resolve(); } else reject(new Error("The PDF upload was not accepted. Please try again.")); };
        xhr.onerror = () => reject(new Error("The PDF upload could not finish. Check your connection and try again."));
        xhr.ontimeout = () => reject(new Error("The upload took too long. Check your connection and try again."));
        xhr.onabort = () => reject(new Error("The PDF upload was interrupted. Please try again."));
        xhr.send(file);
      });

      setStage("extracting");
      const processed = await fetch("/api/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand, issueId: cleanId, issueLabel: cleanLabel, tocPages: [...new Set(pages.map(Number))].sort((a, b) => a - b).join(","), pdfKey: upload.pdfKey }) });
      const result = await processed.json();
      if (!processed.ok || result.error) throw new Error(result.error || "The PDF uploaded, but extraction could not start.");
      if (typeof result.issueUuid !== "string" || !result.issueUuid) throw new Error("The issue could not be opened. Check Print intake before trying again.");
      setStage("done");
      router.push(href(`/admin/${encodeURIComponent(result.issueUuid)}`));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Something went wrong. Please try again.");
      setStage("idle");
    }
  }

  const stageLabel = stage === "preparing" ? "Preparing the upload…" : stage === "uploading" ? `Uploading the PDF · ${progress}%` : stage === "extracting" ? "Starting extraction…" : "Opening the issue…";

  return <>
    <PageHeader icon={Plus} title="Upload an issue" lede="The worker extracts text and images from the production PDF, segments the articles, and sends candidates to review."
      actions={<LinkButton href={href("/cms/print")} icon={ArrowLeft}>Print intake</LinkButton>} />
    <div className="ed-stack" style={{ maxWidth: 780 }}>
      {demo && <Notice tone="warning" icon={FileInput}>Uploads need the connected workspace. <a className="ed-link" href="/login">Sign in</a> to add a print issue; the demo keeps sample content only.</Notice>}
      <Card>
        <form onSubmit={submit} className="ed-form" aria-busy={busy}>
          <fieldset disabled={locked} className="ed-fieldset">
            <legend className="ed-label">Publication</legend>
            <div className="ed-brand-options" role="radiogroup" aria-label="Publication">
              {brands.map((option: CmsBrand) => <button key={option} type="button" role="radio" aria-checked={option === brand} className="ed-brand-option" onClick={() => setBrand(option)}>
                <PublicationLogo brand={option} height={LOGO_HEIGHT[option]} />
                <span>{BRAND_NAMES[option]}</span>
              </button>)}
            </div>
          </fieldset>

          <div className="ed-form-grid">
            <Field label="Issue ID" htmlFor="issue-id" hint="A stable reference of letters, numbers, hyphens or underscores. Reuse it to re-extract this issue.">
              <input id="issue-id" className="ed-input" value={issueId} onChange={event => setIssueId(event.target.value)} disabled={locked} placeholder="fall-2026" maxLength={80} required />
            </Field>
            <Field label="Issue name" htmlFor="issue-name" hint="What editors see in the workspace.">
              <input id="issue-name" className="ed-input" value={issueLabel} onChange={event => setIssueLabel(event.target.value)} disabled={locked} placeholder="Fall 2026" maxLength={200} required />
            </Field>
          </div>

          <Field label="Table of contents pages" htmlFor="toc-pages" hint="PDF page numbers holding the table of contents, separated by commas. Count the cover as page 1; these can differ from the printed folios.">
            <input id="toc-pages" className="ed-input" value={tocPages} onChange={event => setTocPages(event.target.value)} disabled={locked} placeholder="3,4" required style={{ maxWidth: 220 }} />
          </Field>

          <div className="ed-field">
            <label htmlFor="issue-pdf">Issue PDF</label>
            <input id="issue-pdf" ref={fileInput} type="file" accept="application/pdf,.pdf" disabled={locked} onChange={event => selectFile(event.target.files?.[0])} className="ed-visually-hidden" tabIndex={-1} />
            {!file
              ? <button type="button" disabled={locked} className="ed-dropzone" data-dragging={dragging || undefined} onClick={() => fileInput.current?.click()}
                onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
                onDrop={event => { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files?.[0]); }}>
                <UploadCloud size={22} strokeWidth={1.6} aria-hidden />
                <strong>Drop the PDF here, or choose a file</strong>
                <span>PDF files up to 500 MB</span>
              </button>
              : <div className="ed-file-row">
                <FileText size={18} strokeWidth={1.75} aria-hidden />
                <div className="grow"><span className="title">{file.name}</span><span className="meta">{(file.size / (1024 * 1024)).toFixed(1)} MB</span></div>
                <button type="button" className="ed-icon-button small" disabled={busy} aria-label="Remove the selected PDF" onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ""; }}><X size={14} aria-hidden /></button>
              </div>}
          </div>

          <Notice>Extracted articles enter the review queue. Editors check text, bylines, images and extraction notes before anything publishes. Re-extracting an issue keeps saved editorial changes.</Notice>

          {busy && <div className="ed-upload-state" role="status" aria-live="polite">
            <strong>{stageLabel}</strong>
            {stage === "uploading" && <div className="ed-progress" aria-label="Upload progress"><i style={{ width: `${progress}%` }} /></div>}
            <small>Keep this page open until the upload finishes.</small>
          </div>}

          {error && <Notice tone="error">{error}</Notice>}

          <div className="ed-form-actions">
            <LinkButton href={href("/cms/print")}>Cancel</LinkButton>
            <Button type="submit" variant="primary" icon={Sparkles} disabled={locked || !file}>{busy ? "Preparing the issue…" : "Upload and extract"}</Button>
          </div>
        </form>
      </Card>
    </div>
  </>;
}
