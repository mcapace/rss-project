-- The relational "Shanken schema": producers, regions, varieties, tasters and
-- the ratings that join them to documents, plus the Impact Databank brand and
-- volume tables. Additive only. A rating document keeps metadata.rating as the
-- editor's working copy; cms_upsert_rating keeps the relational row in step so
-- faceted search and cross-references read strict tables, never JSON.
--
-- Row Level Security is bound to the JWT: cms_jwt_brands() reads
-- app_metadata.cms_role and cms_brands, the same claims the server routes
-- authorize from, so a user-scoped client can only ever see or change rows in
-- its own publications. The service role keeps full access for the RPCs.

CREATE OR REPLACE FUNCTION public.cms_jwt_brands() RETURNS text[]
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE
    WHEN coalesce(auth.jwt() -> 'app_metadata' ->> 'cms_role', '') = 'admin' THEN ARRAY['wa','ws','ca','mw']
    WHEN coalesce(auth.jwt() -> 'app_metadata' ->> 'cms_role', '') = 'editor' THEN coalesce(ARRAY(
      SELECT value FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(auth.jwt() -> 'app_metadata' -> 'cms_brands') = 'array'
             THEN auth.jwt() -> 'app_metadata' -> 'cms_brands' ELSE '[]'::jsonb END) AS value
      WHERE value IN ('wa','ws','ca','mw')), ARRAY[]::text[])
    ELSE ARRAY[]::text[] END;
$$;
REVOKE ALL ON FUNCTION public.cms_jwt_brands() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cms_jwt_brands() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cms_slugify(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT btrim(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'), '-');
$$;

-- Regions are hierarchical (country > region > appellation).
CREATE TABLE IF NOT EXISTS public.cms_regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL CHECK (brand IN ('wa','ws','ca','mw')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  slug text NOT NULL CHECK (length(slug) BETWEEN 1 AND 220),
  parent_id uuid REFERENCES public.cms_regions(id) ON DELETE RESTRICT,
  country text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand, slug)
);
CREATE INDEX IF NOT EXISTS cms_regions_parent_idx ON public.cms_regions (parent_id);

CREATE TABLE IF NOT EXISTS public.cms_producers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL CHECK (brand IN ('wa','ws','ca','mw')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 300),
  slug text NOT NULL CHECK (length(slug) BETWEEN 1 AND 320),
  -- winery, distillery, cigar_maker, brand_owner, importer, other
  kind text NOT NULL DEFAULT 'other' CHECK (kind IN ('winery','distillery','cigar_maker','brand_owner','importer','other')),
  region_id uuid REFERENCES public.cms_regions(id) ON DELETE SET NULL,
  country text,
  website text CHECK (website IS NULL OR website ~ '^https?://[^[:space:]]+$'),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand, slug)
);
CREATE INDEX IF NOT EXISTS cms_producers_region_idx ON public.cms_producers (region_id);

-- Varieties: grapes for wine, grains and styles for spirits, wrappers for cigars.
CREATE TABLE IF NOT EXISTS public.cms_varieties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL CHECK (brand IN ('wa','ws','ca','mw')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  slug text NOT NULL CHECK (length(slug) BETWEEN 1 AND 220),
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('grape','grain','style','wrapper','blend','other')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand, slug)
);

CREATE TABLE IF NOT EXISTS public.cms_tasters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL CHECK (brand IN ('wa','ws','ca','mw')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  slug text NOT NULL CHECK (length(slug) BETWEEN 1 AND 220),
  initials text,
  title text,
  bio text,
  user_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand, slug)
);

CREATE TABLE IF NOT EXISTS public.cms_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL UNIQUE REFERENCES public.cms_documents(id) ON DELETE CASCADE,
  brand text NOT NULL CHECK (brand IN ('wa','ws','ca','mw')),
  producer_id uuid REFERENCES public.cms_producers(id) ON DELETE SET NULL,
  region_id uuid REFERENCES public.cms_regions(id) ON DELETE SET NULL,
  variety_id uuid REFERENCES public.cms_varieties(id) ON DELETE SET NULL,
  taster_id uuid REFERENCES public.cms_tasters(id) ON DELETE SET NULL,
  product_name text,
  category text,
  vintage smallint CHECK (vintage IS NULL OR vintage BETWEEN 1800 AND 2100),
  score smallint CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  price numeric(10,2) CHECK (price IS NULL OR price >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  abv numeric(5,2) CHECK (abv IS NULL OR abv BETWEEN 0 AND 100),
  drink_window text,
  release_date date,
  tasting_note text,
  reviewed_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cms_ratings_brand_score_idx ON public.cms_ratings (brand, score DESC);
CREATE INDEX IF NOT EXISTS cms_ratings_brand_price_idx ON public.cms_ratings (brand, price);
CREATE INDEX IF NOT EXISTS cms_ratings_producer_idx ON public.cms_ratings (producer_id);
CREATE INDEX IF NOT EXISTS cms_ratings_region_idx ON public.cms_ratings (region_id);
CREATE INDEX IF NOT EXISTS cms_ratings_variety_idx ON public.cms_ratings (variety_id);
CREATE INDEX IF NOT EXISTS cms_ratings_taster_idx ON public.cms_ratings (taster_id);
CREATE INDEX IF NOT EXISTS cms_ratings_vintage_idx ON public.cms_ratings (brand, vintage);

-- Impact Databank: brands and their yearly volumes (thousands of 9-liter cases).
CREATE TABLE IF NOT EXISTS public.cms_databank_brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL DEFAULT 'mw' CHECK (brand IN ('wa','ws','ca','mw')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 300),
  slug text NOT NULL CHECK (length(slug) BETWEEN 1 AND 320),
  owner text,
  category text NOT NULL DEFAULT 'spirits' CHECK (category IN ('spirits','wine','beer','rtd','other')),
  subcategory text,
  origin text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand, slug)
);
CREATE TABLE IF NOT EXISTS public.cms_databank_volumes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL DEFAULT 'mw' CHECK (brand IN ('wa','ws','ca','mw')),
  databank_brand_id uuid NOT NULL REFERENCES public.cms_databank_brands(id) ON DELETE CASCADE,
  year smallint NOT NULL CHECK (year BETWEEN 1900 AND 2100),
  market text NOT NULL DEFAULT 'US',
  cases_thousands numeric(14,2) CHECK (cases_thousands IS NULL OR cases_thousands >= 0),
  estimated boolean NOT NULL DEFAULT false,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (databank_brand_id, year, market)
);
CREATE INDEX IF NOT EXISTS cms_databank_volumes_year_idx ON public.cms_databank_volumes (year, market);

-- Row Level Security bound to the JWT claims. Reads and reference-data writes
-- for authenticated users stay inside their publications; ratings and
-- documents are written only through the service-role RPCs so revision history
-- cannot be skipped.
ALTER TABLE public.cms_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_producers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_varieties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_tasters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_databank_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_databank_volumes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cms_regions, public.cms_producers, public.cms_varieties, public.cms_tasters,
  public.cms_ratings, public.cms_databank_brands, public.cms_databank_volumes FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cms_regions, public.cms_producers, public.cms_varieties, public.cms_tasters,
  public.cms_ratings, public.cms_databank_brands, public.cms_databank_volumes TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.cms_regions, public.cms_producers, public.cms_varieties, public.cms_tasters,
  public.cms_databank_brands, public.cms_databank_volumes TO authenticated;
GRANT SELECT ON public.cms_ratings TO authenticated;
GRANT SELECT ON public.cms_documents TO authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cms_regions','cms_producers','cms_varieties','cms_tasters','cms_databank_brands','cms_databank_volumes'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (brand = ANY (public.cms_jwt_brands()))', t || '_brand_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (brand = ANY (public.cms_jwt_brands()))', t || '_brand_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (brand = ANY (public.cms_jwt_brands())) WITH CHECK (brand = ANY (public.cms_jwt_brands()))', t || '_brand_update', t);
  END LOOP;
END $$;
CREATE POLICY cms_ratings_brand_select ON public.cms_ratings FOR SELECT TO authenticated USING (brand = ANY (public.cms_jwt_brands()));
CREATE POLICY cms_documents_brand_select ON public.cms_documents FOR SELECT TO authenticated USING (brand = ANY (public.cms_jwt_brands()));

-- Keep a rating row in step with a document's metadata.rating. Names are
-- resolved to catalog rows (created when new) so the join tables stay strict.
CREATE OR REPLACE FUNCTION public.cms_upsert_rating(p_document_id uuid, p_rating jsonb, p_actor text DEFAULT 'editor')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_doc public.cms_documents%ROWTYPE;
  v_producer uuid; v_region uuid; v_variety uuid; v_taster uuid;
  v_name text; v_row public.cms_ratings%ROWTYPE;
BEGIN
  SELECT * INTO v_doc FROM public.cms_documents WHERE id = p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Document not found'; END IF;
  IF jsonb_typeof(p_rating) IS DISTINCT FROM 'object' THEN
    DELETE FROM public.cms_ratings WHERE document_id = p_document_id;
    RETURN NULL;
  END IF;

  v_name := nullif(btrim(coalesce(p_rating ->> 'producer', p_rating ->> 'brand', '')), '');
  IF v_name IS NOT NULL THEN
    INSERT INTO public.cms_producers (brand, name, slug) VALUES (v_doc.brand, v_name, public.cms_slugify(v_name))
      ON CONFLICT (brand, slug) DO UPDATE SET updated_at = clock_timestamp() RETURNING id INTO v_producer;
  END IF;
  v_name := nullif(btrim(coalesce(p_rating ->> 'region', '')), '');
  IF v_name IS NOT NULL THEN
    INSERT INTO public.cms_regions (brand, name, slug) VALUES (v_doc.brand, v_name, public.cms_slugify(v_name))
      ON CONFLICT (brand, slug) DO UPDATE SET updated_at = clock_timestamp() RETURNING id INTO v_region;
  END IF;
  v_name := nullif(btrim(coalesce(p_rating ->> 'variety', '')), '');
  IF v_name IS NOT NULL THEN
    INSERT INTO public.cms_varieties (brand, name, slug) VALUES (v_doc.brand, v_name, public.cms_slugify(v_name))
      ON CONFLICT (brand, slug) DO NOTHING;
    SELECT id INTO v_variety FROM public.cms_varieties WHERE brand = v_doc.brand AND slug = public.cms_slugify(v_name);
  END IF;
  v_name := nullif(btrim(coalesce(p_rating ->> 'taster', p_rating ->> 'reviewer', '')), '');
  IF v_name IS NOT NULL THEN
    INSERT INTO public.cms_tasters (brand, name, slug) VALUES (v_doc.brand, v_name, public.cms_slugify(v_name))
      ON CONFLICT (brand, slug) DO NOTHING;
    SELECT id INTO v_taster FROM public.cms_tasters WHERE brand = v_doc.brand AND slug = public.cms_slugify(v_name);
  END IF;

  INSERT INTO public.cms_ratings AS r (document_id, brand, producer_id, region_id, variety_id, taster_id, product_name, category,
      vintage, score, price, currency, abv, drink_window, release_date, tasting_note, reviewed_at)
  VALUES (p_document_id, v_doc.brand, v_producer, v_region, v_variety, v_taster,
      nullif(btrim(coalesce(p_rating ->> 'product_name', v_doc.title)), ''), nullif(btrim(coalesce(p_rating ->> 'category', '')), ''),
      CASE WHEN p_rating ->> 'vintage' ~ '^\d{4}$' THEN (p_rating ->> 'vintage')::smallint END,
      CASE WHEN jsonb_typeof(p_rating -> 'score') = 'number' THEN round((p_rating ->> 'score')::numeric)::smallint END,
      CASE WHEN jsonb_typeof(p_rating -> 'price') = 'number' THEN (p_rating ->> 'price')::numeric(10,2) END,
      CASE WHEN p_rating ->> 'currency' ~ '^[A-Z]{3}$' THEN p_rating ->> 'currency' ELSE 'USD' END,
      CASE WHEN jsonb_typeof(p_rating -> 'abv') = 'number' THEN (p_rating ->> 'abv')::numeric(5,2) END,
      nullif(btrim(coalesce(p_rating ->> 'drink_window', '')), ''),
      CASE WHEN p_rating ->> 'release_date' ~ '^\d{4}-\d{2}-\d{2}$' THEN (p_rating ->> 'release_date')::date END,
      nullif(btrim(coalesce(p_rating ->> 'tasting_note', v_doc.excerpt)), ''),
      CASE WHEN p_rating ->> 'reviewed_at' ~ '^\d{4}-\d{2}-\d{2}' THEN left(p_rating ->> 'reviewed_at', 10)::date END)
  ON CONFLICT (document_id) DO UPDATE SET
      brand = EXCLUDED.brand, producer_id = EXCLUDED.producer_id, region_id = EXCLUDED.region_id, variety_id = EXCLUDED.variety_id,
      taster_id = EXCLUDED.taster_id, product_name = EXCLUDED.product_name, category = EXCLUDED.category, vintage = EXCLUDED.vintage,
      score = EXCLUDED.score, price = EXCLUDED.price, currency = EXCLUDED.currency, abv = EXCLUDED.abv, drink_window = EXCLUDED.drink_window,
      release_date = EXCLUDED.release_date, tasting_note = EXCLUDED.tasting_note, reviewed_at = EXCLUDED.reviewed_at, updated_at = clock_timestamp()
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.cms_upsert_rating(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_upsert_rating(uuid, jsonb, text) TO service_role;

-- Faceted search over the review database: score, price, vintage, region,
-- variety, producer and taster at once, with a total for paging.
CREATE OR REPLACE FUNCTION public.cms_search_ratings(
  p_brands text[], p_query text DEFAULT NULL, p_min_score integer DEFAULT NULL, p_max_score integer DEFAULT NULL,
  p_min_price numeric DEFAULT NULL, p_max_price numeric DEFAULT NULL, p_region text DEFAULT NULL, p_variety text DEFAULT NULL,
  p_producer text DEFAULT NULL, p_taster text DEFAULT NULL, p_vintage_from integer DEFAULT NULL, p_vintage_to integer DEFAULT NULL,
  p_state text DEFAULT NULL, p_sort text DEFAULT 'score', p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
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

CREATE OR REPLACE FUNCTION public.cms_rating_facets(p_brands text[], p_state text DEFAULT NULL)
RETURNS TABLE (facet text, value text, label text, document_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH base AS (
    SELECT r.*, d.publication_state FROM public.cms_ratings r JOIN public.cms_documents d ON d.id = r.document_id
    WHERE r.brand = ANY (p_brands) AND (p_state IS NULL OR d.publication_state = p_state)
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

-- Catalog lookup for the editor's typeahead: producers, regions, varieties or tasters.
CREATE OR REPLACE FUNCTION public.cms_catalog_lookup(p_brand text, p_type text, p_query text, p_limit integer DEFAULT 12)
RETURNS TABLE (id uuid, name text, slug text, detail text, document_count bigint)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_type NOT IN ('producer','region','variety','taster') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Unknown catalog type';
  END IF;
  RETURN QUERY EXECUTE format($f$
    SELECT c.id, c.name, c.slug, %s AS detail, (SELECT count(*) FROM public.cms_ratings r WHERE r.%I = c.id) AS document_count
    FROM public.%I c
    WHERE c.brand = $1 AND (coalesce($2, '') = '' OR c.name ILIKE '%%' || $2 || '%%')
    ORDER BY (c.name ILIKE $2 || '%%') DESC, document_count DESC, c.name
    LIMIT greatest(1, least(coalesce($3, 12), 50))$f$,
    CASE p_type WHEN 'producer' THEN 'coalesce(c.kind, '''')' WHEN 'region' THEN 'coalesce(c.country, '''')' WHEN 'variety' THEN 'coalesce(c.category, '''')' ELSE 'coalesce(c.title, '''')' END,
    p_type || '_id',
    'cms_' || CASE p_type WHEN 'variety' THEN 'varieties' ELSE p_type || 's' END)
  USING p_brand, p_query, p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.cms_search_ratings(text[], text, integer, integer, numeric, numeric, text, text, text, text, integer, integer, text, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cms_rating_facets(text[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cms_catalog_lookup(text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cms_search_ratings(text[], text, integer, integer, numeric, numeric, text, text, text, text, integer, integer, text, text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cms_rating_facets(text[], text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cms_catalog_lookup(text, text, text, integer) TO authenticated, service_role;
