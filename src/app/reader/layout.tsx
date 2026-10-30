import type { ReactNode } from "react";
import { WorkspaceLayout } from "@/components/editorial/WorkspaceLayout";

export const dynamic = "force-dynamic";

/** The legacy edition reader lives in the same editorial shell as /cms. */
export default function ReaderLayout({ children }: { children: ReactNode }) {
  return <WorkspaceLayout>{children}</WorkspaceLayout>;
}
