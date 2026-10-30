import { Suspense, type ReactNode } from "react";
import { loadWorkspaceAccess } from "@/lib/editorial/access-server";
import { THEME_BOOT_SCRIPT } from "@/lib/editorial/theme";
import { CmsRoot } from "@/components/editorial/CmsRoot";
import "@/components/editorial/editorial.css";

export const dynamic = "force-dynamic";

/** Every /cms page shares the editorial shell; the demo opens without a session. */
export default async function CmsLayout({ children }: { children: ReactNode }) {
  const access = await loadWorkspaceAccess();
  return <>
    <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
    <Suspense fallback={<div className="ed ed-access" aria-busy="true" />}>
      <CmsRoot access={access}>{children}</CmsRoot>
    </Suspense>
  </>;
}
