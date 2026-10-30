import "server-only";
import { cmsDb, databaseError } from "./db";
import { CmsError } from "./access";
import type { CmsBrand } from "./types";
import type { CatalogEntry, CatalogType, RatingFacets, RatingFilters, RatingHit, RatingSearchResponse } from "@/lib/editorial/platform-types";

export const CATALOG_TYPES: readonly CatalogType[] = ["producer", "region", "variety", "taster"];

function setupGuard(error: { code?: string }) {
  if (error.code === "PGRST202" || error.code === "42883" || error.code === "42P01") throw new CmsError(503, "The review database is not set up yet: apply the cms_catalog migration.", "setup_required");
  databaseError(error);
}

export async function lookupCatalog(brand: CmsBrand, type: CatalogType, query: string, limit = 12): Promise<CatalogEntry[]> {
  const { data, error } = await cmsDb().rpc("cms_catalog_lookup", { p_brand: brand, p_type: type, p_query: query.slice(0, 120), p_limit: limit });
  if (error) setupGuard(error);
  return ((data ?? []) as CatalogEntry[]).map(row => ({ ...row, document_count: Number(row.document_count) }));
}

/** Keep the relational rating row in step with metadata.rating. Best effort for callers that pass `quiet`. */
export async function syncRating(documentId: string, rating: unknown, actor: string, quiet = false): Promise<void> {
  const { error } = await cmsDb().rpc("cms_upsert_rating", { p_document_id: documentId, p_rating: rating && typeof rating === "object" && !Array.isArray(rating) ? rating : null, p_actor: actor });
  if (error && !quiet) setupGuard(error);
}

const SORTS = new Set(["score", "price", "price_desc", "vintage", "recent"]);

export async function searchRatings(brands: CmsBrand[], filters: RatingFilters): Promise<RatingSearchResponse> {
  const db = cmsDb();
  const sort = filters.sort && SORTS.has(filters.sort) ? filters.sort : "score";
  const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
  const [rows, facets] = await Promise.all([
    db.rpc("cms_search_ratings", {
      p_brands: brands, p_query: filters.q ?? null, p_min_score: filters.min_score ?? null, p_max_score: filters.max_score ?? null,
      p_min_price: filters.min_price ?? null, p_max_price: filters.max_price ?? null, p_region: filters.region ?? null, p_variety: filters.variety ?? null,
      p_producer: filters.producer ?? null, p_taster: filters.taster ?? null, p_vintage_from: filters.vintage_from ?? null, p_vintage_to: filters.vintage_to ?? null,
      p_state: filters.state ?? null, p_sort: sort === "recent" ? "updated" : sort, p_limit: limit, p_offset: Math.max(0, filters.offset ?? 0),
    }),
    db.rpc("cms_rating_facets", { p_brands: brands, p_state: filters.state ?? null }),
  ]);
  if (rows.error) setupGuard(rows.error);
  if (facets.error) setupGuard(facets.error);
  const ratings = ((rows.data ?? []) as RatingHit[]).map(row => ({ ...row, score: row.score === null ? null : Number(row.score), price: row.price === null ? null : Number(row.price), vintage: row.vintage === null ? null : Number(row.vintage), total: Number(row.total) }));
  const grouped: RatingFacets = { region: [], variety: [], producer: [], taster: [], score: [], price: [] };
  for (const row of (facets.data ?? []) as { facet: keyof RatingFacets; value: string; label: string; document_count: number | string }[]) {
    if (row.facet in grouped) grouped[row.facet].push({ value: row.value, label: row.label, count: Number(row.document_count) });
  }
  const order = (keys: string[]) => (a: { value: string }, b: { value: string }) => keys.indexOf(a.value) - keys.indexOf(b.value);
  grouped.score.sort(order(["95", "90", "85", "80", "0"]));
  grouped.price.sort(order(["0", "20", "50", "100", "250"]));
  return { ratings, facets: grouped, total: ratings[0]?.total ?? 0 };
}
