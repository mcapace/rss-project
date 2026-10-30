import { requireCmsUser } from "@/lib/cms/auth-server";
import { assertBrand, CmsError } from "@/lib/cms/access";
import { searchRatings } from "@/lib/cms/catalog-server";
import { cmsFailure, cmsJson } from "@/lib/cms/http";
import { CMS_PUBLICATION_STATES, type CmsBrand, type CmsPublicationState } from "@/lib/cms/types";
import type { RatingFilters } from "@/lib/editorial/platform-types";

function number(value: string | null, name: string, min: number, max: number): number | undefined {
  if (value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new CmsError(422, `${name} must be between ${min} and ${max}.`, "validation_failed");
  return parsed;
}
const slug = (value: string | null) => value && /^[a-z0-9-]{1,220}$/.test(value) ? value : undefined;

/** Faceted search over the review database for the publications a user may see. */
export async function GET(request: Request) {
  try {
    const user = await requireCmsUser();
    const url = new URL(request.url);
    const brandParam = url.searchParams.get("brand");
    const brands: CmsBrand[] = brandParam ? (assertBrand(user, brandParam), [brandParam]) : user.brands;
    const state = url.searchParams.get("state");
    if (state && !(CMS_PUBLICATION_STATES as readonly string[]).includes(state)) throw new CmsError(422, "Unknown publication state.", "validation_failed");
    const filters: RatingFilters = {
      q: (url.searchParams.get("q") ?? "").trim().slice(0, 200) || undefined,
      min_score: number(url.searchParams.get("min_score"), "Score", 0, 100), max_score: number(url.searchParams.get("max_score"), "Score", 0, 100),
      min_price: number(url.searchParams.get("min_price"), "Price", 0, 1_000_000), max_price: number(url.searchParams.get("max_price"), "Price", 0, 1_000_000),
      vintage_from: number(url.searchParams.get("vintage_from"), "Vintage", 1800, 2100), vintage_to: number(url.searchParams.get("vintage_to"), "Vintage", 1800, 2100),
      region: slug(url.searchParams.get("region")), variety: slug(url.searchParams.get("variety")), producer: slug(url.searchParams.get("producer")), taster: slug(url.searchParams.get("taster")),
      state: (state as CmsPublicationState) || undefined, sort: (url.searchParams.get("sort") as RatingFilters["sort"]) || "score",
      limit: number(url.searchParams.get("limit"), "Limit", 1, 200) ?? 50, offset: number(url.searchParams.get("offset"), "Offset", 0, 100_000) ?? 0,
    };
    return cmsJson(await searchRatings(brands, filters));
  } catch (error) { return cmsFailure(error); }
}
