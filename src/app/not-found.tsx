import Link from "next/link";
import { ArrowLeft, FileQuestion } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <main className="flex-1 max-w-lg w-full mx-auto px-4 py-24 flex flex-col items-center justify-center space-y-6">
      <div className="text-center space-y-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#C9A227]">
          404 Error
        </span>
        <h1 className="font-serif text-4xl text-[#EDEDED] font-normal tracking-tight">
          Page Not Found
        </h1>
        <p className="text-xs text-[#9A9AA0] max-w-sm">
          The requested issue, feed endpoint, or admin dashboard resource could not be located.
        </p>
      </div>

      <Card elevated padding="lg" className="w-full text-center space-y-6">
        <div className="w-12 h-12 rounded-2xl bg-[#1B1B1E] border border-[rgba(255,255,255,0.08)] flex items-center justify-center mx-auto text-[#9A9AA0]">
          <FileQuestion className="w-6 h-6" />
        </div>

        <div className="pt-2 flex items-center justify-center gap-3 border-t border-[rgba(255,255,255,0.06)]">
          <Link href="/admin">
            <Button variant="primary" size="md">
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              Return to Issues
            </Button>
          </Link>
        </div>
      </Card>
    </main>
  );
}
