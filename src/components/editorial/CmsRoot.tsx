"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { WorkspaceAccess } from "@/lib/editorial/access-server";
import { AccessScreen } from "./AccessScreen";
import { EditorialProvider } from "./EditorialProvider";
import { Shell } from "./Shell";

/** Chooses the demo or the connected workspace for every page under /cms. */
export function CmsRoot({ access, children }: { access: WorkspaceAccess; children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const demo = searchParams.get("demo") === "1" || pathname.startsWith("/cms/demo");
  const needsSignIn = !demo && !access.ok && access.reason === "sign_in";

  useEffect(() => {
    if (!needsSignIn) return;
    const returnTo = `${pathname}${searchParams.size ? `?${searchParams}` : ""}`;
    router.replace(`/login?redirect=${encodeURIComponent(returnTo)}`);
  }, [needsSignIn, pathname, searchParams, router]);

  if (demo) {
    return <EditorialProvider user={null} demo><Shell>{children}</Shell></EditorialProvider>;
  }
  if (!access.ok) {
    if (access.reason === "sign_in") return <div className="ed ed-access" aria-busy="true" />;
    return <AccessScreen reason={access.reason} />;
  }
  return <EditorialProvider user={access.user} demo={false}><Shell>{children}</Shell></EditorialProvider>;
}
