import { requireCmsUser } from "@/lib/cms/auth-server";
import { assertBrand, CmsError } from "@/lib/cms/access";
import { cmsFailure, cmsJson } from "@/lib/cms/http";
import { AUDIENCE_PERIODS } from "@/lib/editorial/analytics-types";
import { loadGa4Audience, loadGa4Page } from "@/lib/editorial/server/ga4";

/** GA4 audience scorecards for one publication, or one page's performance. */
export async function GET(request: Request) {
  try {
    const user = await requireCmsUser();
    const url = new URL(request.url);
    const brand = url.searchParams.get("brand") ?? "";
    assertBrand(user, brand);
    const days = Number(url.searchParams.get("days") ?? 28);
    if (!(AUDIENCE_PERIODS as readonly number[]).includes(days)) throw new CmsError(422, "Choose a 7, 28 or 90 day period.", "validation_failed");
    const path = url.searchParams.get("path");
    if (path !== null) {
      if (!/^\/[^\s?#]{0,500}$/.test(path)) throw new CmsError(422, "Enter a site path starting with a slash.", "validation_failed");
      return cmsJson({ page: await loadGa4Page(brand, path, days, request.signal) });
    }
    return cmsJson({ report: await loadGa4Audience(brand, days, request.signal) });
  } catch (error) { return cmsFailure(error); }
}
