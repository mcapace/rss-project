import { requireCmsUser } from "@/lib/cms/auth-server";
import { assertBrand, CmsError } from "@/lib/cms/access";
import { CATALOG_TYPES, lookupCatalog } from "@/lib/cms/catalog-server";
import { cmsFailure, cmsJson } from "@/lib/cms/http";
import type { CatalogType } from "@/lib/editorial/platform-types";

/** Typeahead over the relational catalog: producers, regions, varieties, tasters. */
export async function GET(request: Request) {
  try {
    const user = await requireCmsUser();
    const url = new URL(request.url);
    const brand = url.searchParams.get("brand") ?? "";
    assertBrand(user, brand);
    const type = url.searchParams.get("type") ?? "";
    if (!(CATALOG_TYPES as readonly string[]).includes(type)) throw new CmsError(422, "Unknown catalog type.", "validation_failed");
    const entries = await lookupCatalog(brand, type as CatalogType, (url.searchParams.get("q") ?? "").trim(), Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 12) || 12)));
    return cmsJson({ entries });
  } catch (error) { return cmsFailure(error); }
}
