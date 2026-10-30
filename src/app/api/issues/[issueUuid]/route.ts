import { requireCmsUser } from "@/lib/cms/auth-server";
import { CmsError } from "@/lib/cms/access";
import { isUuid } from "@/lib/cms/validation";
import { cmsDb, databaseError } from "@/lib/cms/db";
import { cmsJson, cmsFailure } from "@/lib/cms/http";
export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ issueUuid: string }> }) {
  try {
    const user = await requireCmsUser();
    const { issueUuid } = await params;
    if (!isUuid(issueUuid)) throw new CmsError(404, "Issue not found.");
    const db = cmsDb();
    const { data: issue, error } = await db.from("issues").select("*").eq("id", issueUuid).in("brand", user.brands).maybeSingle();
    if (error) databaseError(error);
    if (!issue) throw new CmsError(404, "Issue not found.");
    const table = issue.status === "published" ? "articles" : "cms_documents";
    const { count, error: countError } = await db.from(table).select("id", { count: "exact", head: true }).eq("issue_uuid", issueUuid);
    if (countError) databaseError(countError);
    return cmsJson({ issue: { ...issue, cms_intake_token: undefined }, articleCount: count || 0, imageCount: issue.stats?.images ?? issue.stats?.image_count ?? null, feedUrl: issue.status === "published" ? `/api/feeds/${issue.brand}/${issue.issue_id}/feed.xml` : null });
  } catch (error) { return cmsFailure(error); }
}
