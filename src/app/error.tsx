"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, RotateCcw } from "lucide-react";
import "@/components/editorial/editorial.css";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("Application error boundary triggered:", error); }, [error]);
  return <main className="ed ed-access">
    <section className="ed-card pad ed-access-card still">
      <span className="ed-wordmark"><span className="ed-wordmark-mark">MS</span><span>Editorial</span></span>
      <h1>Something went wrong</h1>
      <p>The page could not finish loading. Your saved content has not been changed.</p>
      <div className="ed-notice" data-tone="error" role="alert" style={{ marginTop: 16 }}><AlertCircle size={15} aria-hidden /><div style={{ fontFamily: "var(--font-code)", fontSize: 12, overflowWrap: "anywhere" }}>{error?.message || "An unexpected error occurred."}</div></div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 22 }}>
        <button type="button" className="ed-button primary" onClick={() => reset()}><RotateCcw size={15} aria-hidden />Try again</button>
        <Link className="ed-button" href="/cms"><ArrowLeft size={15} aria-hidden />Back to the workspace</Link>
      </div>
    </section>
  </main>;
}
