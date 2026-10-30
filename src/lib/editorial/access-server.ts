import "server-only";
import { authConfiguration, requireCmsUser } from "@/lib/cms/auth-server";
import { CmsError, type CmsUser } from "@/lib/cms/access";

export type WorkspaceAccess =
  | { ok: true; user: CmsUser }
  | { ok: false; reason: "setup" | "denied" | "unavailable" | "sign_in" };

/**
 * Like authorizeCmsPage, but never redirects: the demo must open without a
 * session, so the client decides what to do with a missing sign-in.
 */
export async function loadWorkspaceAccess(): Promise<WorkspaceAccess> {
  if (!authConfiguration()) return { ok: false, reason: "setup" };
  try {
    return { ok: true, user: await requireCmsUser() };
  } catch (error) {
    if (error instanceof CmsError && error.status === 401) return { ok: false, reason: "sign_in" };
    return { ok: false, reason: error instanceof CmsError && error.status === 403 ? "denied" : "unavailable" };
  }
}
