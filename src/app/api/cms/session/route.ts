import { requireCmsUser } from "@/lib/cms/auth-server";
import { cmsJson, cmsFailure } from "@/lib/cms/http";
export async function GET() {
  try { return cmsJson({ user: await requireCmsUser() }); }
  catch (error) { return cmsFailure(error); }
}
