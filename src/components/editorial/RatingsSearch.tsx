"use client";

import { useState } from "react";
import Link from "next/link";
import { Star, X } from "lucide-react";
import { BRAND_NAMES, relativeTime } from "@/lib/editorial/helpers";
import type { RatingFacets, RatingFilters } from "@/lib/editorial/platform-types";
import { useEditorial } from "./EditorialProvider";
import { useAsync } from "./hooks";
import { BrandDot, Card, Empty, Notice, Pill, SkeletonRows } from "./ui";

const FACET_LABELS: Record<keyof RatingFacets, string> = { score: "Score", price: "Price", region: "Region", variety: "Variety", producer: "Producer", taster: "Taster" };
const FACET_ORDER: (keyof RatingFacets)[] = ["score", "price", "region", "variety", "producer", "taster"];
const SORTS: { id: NonNullable<RatingFilters["sort"]>; label: string }[] = [{ id: "score", label: "Highest score" }, { id: "price", label: "Lowest price" }, { id: "price_desc", label: "Highest price" }, { id: "vintage", label: "Newest vintage" }, { id: "recent", label: "Recently edited" }];

type Selection = { score?: string; price?: string; region?: string; variety?: string; producer?: string; taster?: string };

function filtersFrom(query: string, selection: Selection, sort: RatingFilters["sort"]): RatingFilters {
  const filters: RatingFilters = { q: query || undefined, sort, limit: 60, region: selection.region, variety: selection.variety, producer: selection.producer, taster: selection.taster };
  if (selection.score) { const low = Number(selection.score); filters.min_score = low; filters.max_score = low === 95 ? 100 : low === 0 ? 79 : low + 4; }
  if (selection.price) { const low = Number(selection.price); filters.min_price = low; filters.max_price = low === 250 ? undefined : low === 0 ? 19.99 : low === 20 ? 49.99 : low === 50 ? 99.99 : 249.99; }
  return filters;
}

/** The review database with facets: score bands, price bands, region, variety, producer and taster at once. */
export function RatingsSearch({ query, allBrands }: { query: string; allBrands: boolean }) {
  const { brand, data, href } = useEditorial();
  const [selection, setSelection] = useState<Selection>({});
  const [sort, setSort] = useState<NonNullable<RatingFilters["sort"]>>("score");
  const filters = filtersFrom(query, selection, sort);
  const result = useAsync(`ratings:${allBrands ? "all" : brand}:${JSON.stringify(filters)}`, signal => data.searchRatings(allBrands ? null : brand, filters, signal));
  const response = result.data;
  const toggle = (facet: keyof RatingFacets, value: string) => setSelection(current => ({ ...current, [facet]: current[facet] === value ? undefined : value }));
  const active = Object.entries(selection).filter(([, value]) => value) as [keyof RatingFacets, string][];
  const setupError = result.error && /set up|migration/i.test(result.error);

  return <div className="ed-ratings">
    <aside className="ed-facets">
      {response ? FACET_ORDER.map(facet => {
        const values = response.facets[facet];
        if (!values.length) return null;
        return <div key={facet} className="ed-facet">
          <h4>{FACET_LABELS[facet]}</h4>
          {values.slice(0, facet === "producer" ? 12 : 8).map(item => <button key={item.value} type="button" aria-pressed={selection[facet] === item.value} onClick={() => toggle(facet, item.value)}><span>{item.label}</span><em>{item.count}</em></button>)}
        </div>;
      }) : <SkeletonRows rows={5} />}
    </aside>
    <div style={{ minWidth: 0 }}>
      <Card pad={false} className="still">
        <div className="ed-section-head" style={{ padding: "14px 16px 0" }}>
          <div><h2 className="ed-section-title">Ratings <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {response?.total ?? "…"}</span></h2>
            {active.length > 0 && <p style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>{active.map(([facet, value]) => <button key={facet} type="button" className="ed-keyword" onClick={() => toggle(facet, value)}>{FACET_LABELS[facet]}: {response?.facets[facet].find(item => item.value === value)?.label ?? value}<X size={11} aria-hidden /></button>)}<button type="button" className="ed-link" style={{ fontSize: 12 }} onClick={() => setSelection({})}>Clear</button></p>}
          </div>
          <select className="ed-select" style={{ width: "auto" }} aria-label="Sort ratings" value={sort} onChange={event => setSort(event.target.value as NonNullable<RatingFilters["sort"]>)}>{SORTS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
        </div>
        {result.error ? <div style={{ padding: 16 }}>{setupError ? <Empty icon={Star} title="The review database is not set up yet" text={result.error} /> : <Notice tone="error">{result.error}</Notice>}</div>
          : result.loading && !response ? <div style={{ padding: 16 }}><SkeletonRows rows={6} /></div>
          : !response?.ratings.length ? <Empty icon={Star} title="No ratings match" text="Loosen a facet or change the words. Ratings appear here once a story of kind Rating has a score, producer or region." />
          : <div className="ed-table-wrap"><table className="ed-table ed-rating-table">
            <thead><tr><th>Wine, spirit or cigar</th><th>Producer</th><th>Region</th><th>Variety</th><th className="num">Vintage</th><th className="num">Score</th><th className="num">Price</th><th>Taster</th><th>State</th></tr></thead>
            <tbody>{response.ratings.map(row => <tr key={row.document_id}>
              <td><div className="title-cell"><Link href={href(`/cms/doc/${row.document_id}`)}>{row.product_name || row.title}</Link><small>{allBrands ? <><BrandDot brand={row.brand} /> {BRAND_NAMES[row.brand]} · </> : ""}{row.category ? `${row.category} · ` : ""}updated {relativeTime(row.updated_at)}</small></div></td>
              <td className="muted">{row.producer ?? "—"}</td><td className="muted">{row.region ?? "—"}</td><td className="muted">{row.variety ?? "—"}</td>
              <td className="num muted">{row.vintage ?? "—"}</td><td className="num"><strong>{row.score ?? "—"}</strong></td><td className="num muted">{row.price !== null ? `$${row.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}</td>
              <td className="muted">{row.taster ?? "—"}</td><td><Pill tone={row.publication_state} /></td>
            </tr>)}</tbody>
          </table></div>}
      </Card>
    </div>
  </div>;
}
