import type { ReactNode } from "react";
import { WorkspaceLayout } from "@/components/editorial/WorkspaceLayout";

export const dynamic = "force-dynamic";

/** Every /cms page shares the editorial shell; the demo opens without a session. */
export default function CmsLayout({ children }: { children: ReactNode }) {
  return <WorkspaceLayout>{children}</WorkspaceLayout>;
}
