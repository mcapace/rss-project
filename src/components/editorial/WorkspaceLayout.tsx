import { Suspense, type ReactNode } from "react";
import { loadWorkspaceAccess } from "@/lib/editorial/access-server";
import { CmsRoot } from "./CmsRoot";
import "./editorial.css";

/**
 * The editorial shell for every workspace route (/cms, /admin, /reader).
 * Loads the session without redirecting so the demo opens without one; the
 * client decides what a missing sign-in means.
 */
export async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const access = await loadWorkspaceAccess();
  return <Suspense fallback={<div className="ed ed-access" aria-busy="true" />}>
    <CmsRoot access={access}>{children}</CmsRoot>
  </Suspense>;
}
