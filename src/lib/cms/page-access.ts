import "server-only";
import { redirect } from "next/navigation";
import { authConfiguration, requireCmsUser } from "./auth-server";
import { CmsError, safeRedirect, type CmsUser } from "./access";

export type PageAccess = { ok: true; user: CmsUser } | { ok: false; reason: "setup" | "denied" | "unavailable" };

export async function authorizeCmsPage(returnTo = "/cms"): Promise<PageAccess> {
  if (!authConfiguration()) return { ok: false, reason: "setup" };
  try {
    return { ok: true, user: await requireCmsUser() };
  } catch (error) {
    if (error instanceof CmsError && error.status === 401) redirect(`/login?redirect=${encodeURIComponent(safeRedirect(returnTo))}`);
    return { ok: false, reason: error instanceof CmsError && error.status === 403 ? "denied" : "unavailable" };
  }
}
