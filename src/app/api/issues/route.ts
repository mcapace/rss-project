import { requireCmsUser } from "@/lib/cms/auth-server";
import { assertBrand } from "@/lib/cms/access";
import { cmsDb, databaseError } from "@/lib/cms/db";
import { cmsJson, cmsFailure } from "@/lib/cms/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await requireCmsUser();
    const brand = new URL(request.url).searchParams.get("brand");
    if (brand && brand !== "all") assertBrand(user, brand);
    const db = cmsDb();
    // Apply publication scope before the limit so another publication cannot hide its issues.
    const { data, error, count } = await db.from("issues").select("*", { count: "exact" }).in("brand", brand && brand !== "all" ? [brand] : user.brands).order("created_at", { ascending: false }).limit(100);
    if (error) databaseError(error);
    const issues = (data || []).map(issue => ({ ...issue, cms_intake_token: undefined, articleCount: issue.stats?.cms_document_count ?? issue.stats?.articles ?? null, feedUrl: issue.status === "published" ? `/api/feeds/${issue.brand}/${issue.issue_id}/feed.xml` : null }));
    return cmsJson({ issues, total: count || 0, limit: 100 });
  } catch (error) { return cmsFailure(error); }
}
