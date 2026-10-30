import { requireCmsUser } from "@/lib/cms/auth-server";
import { assertBrand } from "@/lib/cms/access";
import { cmsDb, databaseError } from "@/lib/cms/db";
import { cmsJson, cmsFailure } from "@/lib/cms/http";

export async function GET(request: Request) {
  try {
    const user = await requireCmsUser();
    const brand = new URL(request.url).searchParams.get("brand");
    if (brand) assertBrand(user, brand);
    const db = cmsDb();
    const base = () => db.from("cms_documents").select("id", { head: true, count: "exact" }).in("brand", brand ? [brand] : user.brands);
    const counts = await Promise.all([base(), base().eq("publication_state", "review"), base().eq("publication_state", "draft"), base().eq("kind", "rating")]);
    for (const result of counts) if (result.error) databaseError(result.error);
    return cmsJson({ total: counts[0].count, review: counts[1].count, drafts: counts[2].count, ratings: counts[3].count });
  } catch (error) { return cmsFailure(error); }
}
