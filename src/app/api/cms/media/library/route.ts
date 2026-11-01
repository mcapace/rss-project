import { requireCmsUser } from "@/lib/cms/auth-server";
import { cmsFailure, cmsJson } from "@/lib/cms/http";
import { mediaLibraryOverview } from "@/lib/cms/media-library-server";
import { brandValue } from "@/lib/cms/validation";

export const runtime = "nodejs";

/** Every Morweb gallery with its file counts by copy status and a cover. */
export async function GET(request: Request) {
  try {
    const user = await requireCmsUser();
    const brand = brandValue(new URL(request.url).searchParams.get("brand"));
    return cmsJson(await mediaLibraryOverview(brand, user));
  } catch (error) { return cmsFailure(error); }
}
