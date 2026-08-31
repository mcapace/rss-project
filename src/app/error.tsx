"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error boundary triggered:", error);
  }, [error]);

  return (
    <main className="flex-1 max-w-lg w-full mx-auto px-4 py-24 flex flex-col items-center justify-center space-y-6">
      <div className="text-center space-y-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#F87171]">
          System Alert
        </span>
        <h1 className="font-serif text-4xl text-[#EDEDED] font-normal tracking-tight">
          Application Error
        </h1>
        <p className="text-xs text-[#9A9AA0] max-w-sm">
          An unexpected error occurred while executing this operation.
        </p>
      </div>

      <Card elevated padding="lg" className="w-full space-y-6">
        <div className="p-4 rounded-xl bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.25)] text-[#F87171] flex items-start gap-3">
          <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
          <div className="text-xs font-mono break-words">
            {error?.message || "An unhandled server or client exception occurred."}
          </div>
        </div>

        <div className="pt-2 flex items-center justify-end gap-3 border-t border-[rgba(255,255,255,0.06)]">
          <Link href="/admin">
            <Button variant="ghost" size="md">
              Return to Issues
            </Button>
          </Link>
          <Button onClick={() => reset()} variant="primary" size="md">
            <RotateCcw className="w-4 h-4 mr-1.5" />
            Try Again
          </Button>
        </div>
      </Card>
    </main>
  );
}
