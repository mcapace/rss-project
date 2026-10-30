import type { ReactNode } from "react";
import { WorkspaceLayout } from "@/components/editorial/WorkspaceLayout";

export const dynamic = "force-dynamic";

/** Print intake pages live in the same editorial shell as /cms. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <WorkspaceLayout>{children}</WorkspaceLayout>;
}
