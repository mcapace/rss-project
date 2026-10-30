-- Full-text search over editable CMS records and their media, additive only.
-- No existing column, row, policy or privilege changes. The server endpoint
-- authorizes publications before calling these functions.

ALTER TABLE public.cms_documents
  ADD COLUMN IF NOT EXISTS search_text tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(byline, '') || ' ' || coalesce(excerpt, '') || ' ' || coalesce(slug, '')), 'B')
    || setweight(to_tsvector('english',
         coalesce(metadata->>'section', '') || ' ' || coalesce(metadata->>'categories', '') || ' ' || coalesce(metadata->>'tags', '')
         || ' ' || coalesce(metadata->'seo'->>'title', '') || ' ' || coalesce(metadata->'seo'->>'description', '')), 'B')
    || setweight(to_tsvector('english', regexp_replace(coalesce(body_html, ''), '<[^>]+>', ' ', 'g')), 'C')
    || setweight(to_tsvector('english', coalesce(metadata->>'media', '')), 'D')
  ) STORED;

CREATE INDEX IF NOT EXISTS cms_documents_search_text_idx ON public.cms_documents USING gin (search_text);

-- Documents: ranked full-text matches with a highlighted snippet. Short or
-- symbol-only queries fall back to a title match so "46%" still finds a rating.
CREATE OR REPLACE FUNCTION public.cms_search_documents(
  p_brands text[], p_query text, p_kind text DEFAULT NULL, p_state text DEFAULT NULL, p_limit integer DEFAULT 20
) RETURNS TABLE (
  id uuid, brand text, kind text, source_system text, title text, byline text, excerpt text,
  publication_state text, issue_uuid uuid, published_at timestamptz, updated_at timestamptz,
  rank real, headline text
) LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH q AS (SELECT websearch_to_tsquery('english', coalesce(p_query, '')) AS tsq, '%' || coalesce(p_query, '') || '%' AS pattern)
  SELECT d.id, d.brand, d.kind, d.source_system, d.title, d.byline, d.excerpt, d.publication_state, d.issue_uuid,
         d.published_at, d.updated_at,
         (CASE WHEN numnode(q.tsq) > 0 THEN ts_rank_cd(d.search_text, q.tsq) ELSE 0 END
          + CASE WHEN d.title ILIKE q.pattern THEN 0.5 ELSE 0 END)::real AS rank,
         CASE WHEN numnode(q.tsq) > 0
              THEN ts_headline('english', regexp_replace(coalesce(d.body_html, ''), '<[^>]+>', ' ', 'g'), q.tsq,
                               'MaxFragments=2, MaxWords=18, MinWords=6, StartSel=<mark>, StopSel=</mark>, FragmentDelimiter= … ')
              ELSE left(coalesce(d.excerpt, ''), 180) END AS headline
  FROM public.cms_documents d, q
  WHERE d.brand = ANY (p_brands)
    AND (p_kind IS NULL OR d.kind = p_kind)
    AND (p_state IS NULL OR d.publication_state = p_state)
    AND ((numnode(q.tsq) > 0 AND d.search_text @@ q.tsq) OR d.title ILIKE q.pattern OR d.byline ILIKE q.pattern)
  ORDER BY rank DESC, d.updated_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 20), 100));
$$;

-- Media: every image attached to a document, searchable by caption, credit,
-- alt text, file name, and the AI description, style, subjects and palette
-- names stored on the item. This is how "search by the look of the image" works.
CREATE OR REPLACE FUNCTION public.cms_search_media(
  p_brands text[], p_query text, p_limit integer DEFAULT 40
) RETURNS TABLE (
  document_id uuid, brand text, issue_uuid uuid, document_title text, media_index integer,
  file text, s3_key text, caption text, credit text, alt text, is_lead boolean,
  vision jsonb, palette jsonb, crops jsonb, rank real
) LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH q AS (SELECT websearch_to_tsquery('english', coalesce(p_query, '')) AS tsq, '%' || coalesce(p_query, '') || '%' AS pattern),
  items AS (
    SELECT d.id AS document_id, d.brand, d.issue_uuid, d.title AS document_title, (m.ordinality - 1)::integer AS media_index, m.item
    FROM public.cms_documents d
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.metadata->'media') = 'array' THEN d.metadata->'media' ELSE '[]'::jsonb END)
      WITH ORDINALITY AS m(item, ordinality)
    WHERE d.brand = ANY (p_brands)
  ),
  scored AS (
    SELECT i.*, to_tsvector('english',
      coalesce(i.item->>'caption', '') || ' ' || coalesce(i.item->>'credit', '') || ' ' || coalesce(i.item->>'alt', '') || ' '
      || coalesce(i.item->>'file', '') || ' ' || coalesce(i.item->'vision'->>'description', '') || ' ' || coalesce(i.item->'vision'->>'style', '') || ' '
      || coalesce(i.item->'vision'->>'mood', '') || ' ' || coalesce(i.item->'vision'->>'tags', '') || ' ' || coalesce(i.item->'vision'->>'subjects', '') || ' '
      || coalesce(i.item->'vision'->>'colors', '') || ' ' || coalesce(i.item->>'palette_names', '')) AS doc
    FROM items i
  )
  SELECT s.document_id, s.brand, s.issue_uuid, s.document_title, s.media_index,
         s.item->>'file', s.item->>'s3_key', s.item->>'caption', s.item->>'credit', s.item->>'alt',
         coalesce((s.item->>'is_lead')::boolean, false), s.item->'vision', s.item->'palette', s.item->'crops',
         (CASE WHEN numnode(q.tsq) > 0 THEN ts_rank_cd(s.doc, q.tsq) ELSE 0 END)::real AS rank
  FROM scored s, q
  WHERE (numnode(q.tsq) > 0 AND s.doc @@ q.tsq) OR coalesce(s.item->>'file', '') ILIKE q.pattern OR coalesce(s.item->>'caption', '') ILIKE q.pattern
  ORDER BY rank DESC, s.document_title
  LIMIT greatest(1, least(coalesce(p_limit, 40), 200));
$$;

-- Keywords: tags, categories and sections with how many documents carry them.
CREATE OR REPLACE FUNCTION public.cms_search_keywords(
  p_brands text[], p_query text, p_limit integer DEFAULT 30
) RETURNS TABLE (keyword text, kind text, document_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH terms AS (
    SELECT lower(trim(value)) AS keyword, 'tag' AS kind FROM public.cms_documents d,
      jsonb_array_elements_text(CASE WHEN jsonb_typeof(d.metadata->'tags') = 'array' THEN d.metadata->'tags' ELSE '[]'::jsonb END) AS value
      WHERE d.brand = ANY (p_brands)
    UNION ALL
    SELECT lower(trim(value)), 'category' FROM public.cms_documents d,
      jsonb_array_elements_text(CASE WHEN jsonb_typeof(d.metadata->'categories') = 'array' THEN d.metadata->'categories' ELSE '[]'::jsonb END) AS value
      WHERE d.brand = ANY (p_brands)
    UNION ALL
    SELECT lower(trim(d.metadata->>'section')), 'section' FROM public.cms_documents d
      WHERE d.brand = ANY (p_brands) AND coalesce(d.metadata->>'section', '') <> ''
  )
  SELECT t.keyword, t.kind, count(*) AS document_count
  FROM terms t
  WHERE t.keyword <> '' AND (coalesce(p_query, '') = '' OR t.keyword ILIKE '%' || p_query || '%')
  GROUP BY t.keyword, t.kind
  ORDER BY document_count DESC, t.keyword
  LIMIT greatest(1, least(coalesce(p_limit, 30), 200));
$$;

GRANT EXECUTE ON FUNCTION public.cms_search_documents(text[], text, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cms_search_media(text[], text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cms_search_keywords(text[], text, integer) TO service_role;
