import { requireCmsUser } from "@/lib/cms/auth-server";
import { cmsFailure, cmsJson } from "@/lib/cms/http";
import { getCmsMigrationInventory } from "@/lib/cms/migration-server";
import { brandValue } from "@/lib/cms/validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireCmsUser();
    const brand = brandValue(new URL(request.url).searchParams.get("brand"));
    return cmsJson({ inventory: await getCmsMigrationInventory(brand, user) });
  } catch (error) { return cmsFailure(error); }
}
