import { requireCmsUser } from "@/lib/cms/auth-server";
import { assertBrand, CmsError } from "@/lib/cms/access";
import { cmsFailure } from "@/lib/cms/http";
import { consentUrl } from "@/lib/editorial/server/google-oauth";

/** Start the Google consent flow for one publication's Analytics connection (administrators only). */
export async function GET(request: Request) {
  try {
    const user = await requireCmsUser();
    if (user.role !== "admin") throw new CmsError(403, "Only administrators can connect Analytics.", "access_denied");
    const brand = new URL(request.url).searchParams.get("brand") ?? "";
    assertBrand(user, brand);
    return Response.redirect(consentUrl(brand, user.id), 302);
  } catch (error) { return cmsFailure(error); }
}
