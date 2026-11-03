-- Public ratings search counts only live ratings (2026-11-03).
--
-- A rating an editor schedules is published with published_at still ahead (cms_publish_document), and the site treats it
-- as live only once that time has come: publication_state = 'published' AND (published_at IS NULL OR published_at <=
-- now()), the rule in src/lib/wa/live.ts. cms_search_ratings and cms_rating_facets (20261101100000_cms_catalog.sql)
-- checked publication_state alone, so the public ratings API (/api/public/<brand>/ratings) dropped a scheduled rating
-- from its rows only after LIMIT/OFFSET: pages came back short, `total` still counted it, and its producer, region and
-- taster showed in the facets.
--
-- Both functions gain p_live (default false). With p_live they keep only live ratings before counting, paging and
-- faceting. Editor callers (/api/cms/ratings) never pass it and see scheduled ratings as before. The new parameter
-- changes the signatures, so the old functions are dropped and recreated with the same settings and grants.
-- Until this is applied the public route falls back to the old call and drops scheduled rows itself
-- (searchRatings in src/lib/cms/catalog-server.ts). Cheap to apply: it only replaces two functions. Safe to run again.

DROP FUNCTION IF EXISTS public.cms_search_ratings(text[], text, integer, integer, numeric, numeric, text, text, text, text, integer, integer, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.cms_rating_facets(text[], text);

CREATE OR REPLACE FUNCTION public.cms_search_ratings(
  p_brands text[], p_query text DEFAULT NULL, p_min_score integer DEFAULT NULL, p_max_score integer DEFAULT NULL,
  p_min_price numeric DEFAULT NULL, p_max_price numeric DEFAULT NULL, p_region text DEFAULT NULL, p_variety text DEFAULT NULL,
  p_producer text DEFAULT NULL, p_taster text DEFAULT NULL, p_vintage_from integer DEFAULT NULL, p_vintage_to integer DEFAULT NULL,
  p_state text DEFAULT NULL, p_sort text DEFAULT 'score', p_limit integer DEFAULT 50, p_offset integer DEFAULT 0,
  p_live boolean DEFAULT false
) RETURNS TABLE (
  document_id uuid, brand text, title text, slug text, publication_state text, score smallint, price numeric, vintage smallint,
  product_name text, category text, producer text, producer_slug text, region text, region_slug text, variety text, variety_slug text,
  taster text, taster_slug text, drink_window text, published_at timestamptz, updated_at timestamptz, total bigint
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH q AS (SELECT websearch_to_tsquery('english', coalesce(p_query, '')) AS tsq, '%' || coalesce(p_query, '') || '%' AS pattern),
  hits AS (
    SELECT r.document_id, d.brand, d.title, d.slug, d.publication_state, r.score, r.price, r.vintage, r.product_name, r.category,
           p.name AS producer, p.slug AS producer_slug, g.name AS region, g.slug AS region_slug, v.name AS variety, v.slug AS variety_slug,
           t.name AS taster, t.slug AS taster_slug, r.drink_window, d.published_at, d.updated_at
    FROM public.cms_ratings r
    JOIN public.cms_documents d ON d.id = r.document_id
    LEFT JOIN public.cms_producers p ON p.id = r.producer_id
    LEFT JOIN public.cms_regions g ON g.id = r.region_id
    LEFT JOIN public.cms_varieties v ON v.id = r.variety_id
    LEFT JOIN public.cms_tasters t ON t.id = r.taster_id, q
    WHERE r.brand = ANY (p_brands)
      AND (p_state IS NULL OR d.publication_state = p_state)
      AND (NOT coalesce(p_live, false) OR (d.publication_state = 'published' AND (d.published_at IS NULL OR d.published_at <= now())))
      AND (p_min_score IS NULL OR r.score >= p_min_score) AND (p_max_score IS NULL OR r.score <= p_max_score)
      AND (p_min_price IS NULL OR r.price >= p_min_price) AND (p_max_price IS NULL OR r.price <= p_max_price)
      AND (p_vintage_from IS NULL OR r.vintage >= p_vintage_from) AND (p_vintage_to IS NULL OR r.vintage <= p_vintage_to)
      AND (p_region IS NULL OR g.slug = p_region) AND (p_variety IS NULL OR v.slug = p_variety)
      AND (p_producer IS NULL OR p.slug = p_producer) AND (p_taster IS NULL OR t.slug = p_taster)
      AND (coalesce(p_query, '') = '' OR (numnode(q.tsq) > 0 AND d.search_text @@ q.tsq) OR d.title ILIKE q.pattern OR p.name ILIKE q.pattern)
  )
  SELECT h.*, count(*) OVER () AS total
  FROM hits h
  ORDER BY
    CASE WHEN p_sort = 'score' THEN h.score END DESC NULLS LAST,
    CASE WHEN p_sort = 'price' THEN h.price END ASC NULLS LAST,
    CASE WHEN p_sort = 'price_desc' THEN h.price END DESC NULLS LAST,
    CASE WHEN p_sort = 'vintage' THEN h.vintage END DESC NULLS LAST,
    h.updated_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 50), 200)) OFFSET greatest(0, coalesce(p_offset, 0));
$$;

CREATE OR REPLACE FUNCTION public.cms_rating_facets(p_brands text[], p_state text DEFAULT NULL, p_live boolean DEFAULT false)
RETURNS TABLE (facet text, value text, label text, document_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH base AS (
    SELECT r.*, d.publication_state FROM public.cms_ratings r JOIN public.cms_documents d ON d.id = r.document_id
    WHERE r.brand = ANY (p_brands) AND (p_state IS NULL OR d.publication_state = p_state)
      AND (NOT coalesce(p_live, false) OR (d.publication_state = 'published' AND (d.published_at IS NULL OR d.published_at <= now())))
  )
  SELECT * FROM (
    SELECT 'region' AS facet, g.slug AS value, g.name AS label, count(*) AS document_count FROM base b JOIN public.cms_regions g ON g.id = b.region_id GROUP BY g.slug, g.name
    UNION ALL
    SELECT 'variety', v.slug, v.name, count(*) FROM base b JOIN public.cms_varieties v ON v.id = b.variety_id GROUP BY v.slug, v.name
    UNION ALL
    SELECT 'producer', p.slug, p.name, count(*) FROM base b JOIN public.cms_producers p ON p.id = b.producer_id GROUP BY p.slug, p.name
    UNION ALL
    SELECT 'taster', t.slug, t.name, count(*) FROM base b JOIN public.cms_tasters t ON t.id = b.taster_id GROUP BY t.slug, t.name
    UNION ALL
    SELECT 'score', band.value, band.label, count(*) FROM base b
      JOIN LATERAL (SELECT CASE WHEN b.score >= 95 THEN '95' WHEN b.score >= 90 THEN '90' WHEN b.score >= 85 THEN '85' WHEN b.score >= 80 THEN '80' ELSE '0' END AS value,
                           CASE WHEN b.score >= 95 THEN '95 and above' WHEN b.score >= 90 THEN '90 to 94' WHEN b.score >= 85 THEN '85 to 89' WHEN b.score >= 80 THEN '80 to 84' ELSE 'Below 80' END AS label) band ON b.score IS NOT NULL
      GROUP BY band.value, band.label
    UNION ALL
    SELECT 'price', band.value, band.label, count(*) FROM base b
      JOIN LATERAL (SELECT CASE WHEN b.price < 20 THEN '0' WHEN b.price < 50 THEN '20' WHEN b.price < 100 THEN '50' WHEN b.price < 250 THEN '100' ELSE '250' END AS value,
                           CASE WHEN b.price < 20 THEN 'Under $20' WHEN b.price < 50 THEN '$20 to $49' WHEN b.price < 100 THEN '$50 to $99' WHEN b.price < 250 THEN '$100 to $249' ELSE '$250 and up' END AS label) band ON b.price IS NOT NULL
      GROUP BY band.value, band.label
  ) facets
  ORDER BY facet, document_count DESC, label
  LIMIT 400;
$$;

REVOKE ALL ON FUNCTION public.cms_search_ratings(text[], text, integer, integer, numeric, numeric, text, text, text, text, integer, integer, text, text, integer, integer, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cms_rating_facets(text[], text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cms_search_ratings(text[], text, integer, integer, numeric, numeric, text, text, text, text, integer, integer, text, text, integer, integer, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cms_rating_facets(text[], text, boolean) TO authenticated, service_role;
