import { NextResponse } from "next/server";
import { searchRatings } from "@/lib/cms/catalog-server";
import { isBrand } from "@/lib/delivery/content-server";
import type { RatingFilters } from "@/lib/editorial/platform-types";

export const runtime = "nodejs";

const number = (value: string | null, min: number, max: number) => { const n = value === null || value === "" ? NaN : Number(value); return Number.isFinite(n) && n >= min && n <= max ? n : undefined; };
const slug = (value: string | null) => value && /^[a-z0-9-]{1,220}$/.test(value) ? value : undefined;

/** Faceted review search for the public sites: published ratings only, filtered by score, price, vintage, region, variety, producer and taster. */
export async function GET(request: Request, { params }: { params: Promise<{ brand: string }> }) {
  const { brand } = await params;
  if (!isBrand(brand)) return NextResponse.json({ error: "Unknown publication." }, { status: 404 });
  const url = new URL(request.url);
  const filters: RatingFilters = {
    q: (url.searchParams.get("q") ?? "").trim().slice(0, 200) || undefined, state: "published",
    min_score: number(url.searchParams.get("min_score"), 0, 100), max_score: number(url.searchParams.get("max_score"), 0, 100),
    min_price: number(url.searchParams.get("min_price"), 0, 1_000_000), max_price: number(url.searchParams.get("max_price"), 0, 1_000_000),
    vintage_from: number(url.searchParams.get("vintage_from"), 1800, 2100), vintage_to: number(url.searchParams.get("vintage_to"), 1800, 2100),
    region: slug(url.searchParams.get("region")), variety: slug(url.searchParams.get("variety")), producer: slug(url.searchParams.get("producer")), taster: slug(url.searchParams.get("taster")),
    sort: (url.searchParams.get("sort") as RatingFilters["sort"]) || "score", limit: number(url.searchParams.get("limit"), 1, 100) ?? 24, offset: number(url.searchParams.get("offset"), 0, 100_000) ?? 0,
  };
  try {
    const result = await searchRatings([brand], filters);
    const ratings = result.ratings.map(row => ({ ...row, canonical_path: row.slug ? `/${row.brand}/${row.slug}` : null, publication_state: undefined, total: undefined }));
    return NextResponse.json({ brand, ratings, facets: result.facets, total: result.total }, { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" } });
  } catch {
    return NextResponse.json({ error: "Ratings are temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
