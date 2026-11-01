import { requireCmsUser } from "@/lib/cms/auth-server";
import { cmsFailure, cmsJson } from "@/lib/cms/http";
import { mediaLibraryFiles } from "@/lib/cms/media-library-server";
import { brandValue } from "@/lib/cms/validation";

export const runtime = "nodejs";

/** One page of library files: a gallery's, or a search across all of them, with the stories that use each. */
export async function GET(request: Request) {
  try {
    const user = await requireCmsUser();
    const params = new URL(request.url).searchParams;
    const brand = brandValue(params.get("brand"));
    return cmsJson(await mediaLibraryFiles(brand, user, {
      gallery: params.get("gallery"), q: params.get("q"), status: params.get("status"),
      offset: Number(params.get("offset") ?? 0) || 0, limit: Number(params.get("limit") ?? 60) || 60,
    }));
  } catch (error) { return cmsFailure(error); }
}
