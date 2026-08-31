import Link from "next/link";
import { ArrowLeft, Clock, RefreshCw, FileText, Globe } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { BrandMark } from "@/components/ui/BrandMark";

export default async function IssueStatusPage({
  params,
}: {
  params: Promise<{ issueUuid: string }>;
}) {
  const resolvedParams = await params;
  const { issueUuid } = resolvedParams;

  return (
    <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-10 space-y-8">
      <div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-xs text-[#9A9AA0] hover:text-[#EDEDED] transition-colors mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Issues</span>
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9A9AA0]">
              Issue Status & Pipeline
            </span>
            <h1 className="font-serif text-3xl sm:text-4xl text-[#EDEDED] font-normal tracking-tight mt-1">
              Issue Processing
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status="processing" brand="mw" />
          </div>
        </div>
      </div>

      <Card elevated padding="lg" className="space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center gap-3">
            <BrandMark brand="mw" size="lg" />
            <div>
              <h2 className="font-serif text-xl text-[#EDEDED] font-normal">
                Issue Queue Item
              </h2>
              <p className="font-mono text-xs text-[#9A9AA0] mt-0.5">
                UUID: {issueUuid}
              </p>
            </div>
          </div>
          <span className="text-xs font-mono text-[#9A9AA0]">Just now</span>
        </div>

        <div className="py-8 text-center space-y-3">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto text-[#C9A227]" />
          <h3 className="font-serif text-lg text-[#EDEDED]">
            Processing Worker In Flight
          </h3>
          <p className="text-xs text-[#9A9AA0] max-w-md mx-auto">
            The PDF has been securely uploaded to S3. Step 4 will introduce live SWR polling, article review, and automated pipeline step cards.
          </p>
        </div>

        <div className="pt-4 border-t border-[rgba(255,255,255,0.06)] flex items-center justify-between text-xs">
          <Link href="/admin">
            <Button variant="ghost" size="sm">
              Return to Issues
            </Button>
          </Link>
          <Link href={`/?url=${encodeURIComponent(`/api/feeds/mw/${issueUuid}/feed.xml`)}`}>
            <Button variant="outline" size="sm">
              <Globe className="w-3.5 h-3.5 mr-1" />
              Preview in Reader
            </Button>
          </Link>
        </div>
      </Card>
    </main>
  );
}
