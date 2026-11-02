-- Meaning-based matches among published Whisky Advocate documents of chosen kinds (ratings, stories), for the
-- site's search and "bottles like this". cms_match_embeddings returns every kind and state; filtering its top
-- rows afterwards loses most of them, so this filters inside the scan, with HNSW's iterative scan and a deeper
-- candidate list so a filtered query still fills its limit.
-- The hnsw.* settings exist only once pgvector's library is loaded; using a vector loads it.
-- Databases without pgvector (local test harnesses) have no cms_embeddings table, so this is skipped there,
-- like the semantic index in 20261101120000_cms_embeddings.sql.
DO $outer$
BEGIN
  IF to_regclass('public.cms_embeddings') IS NULL THEN
    RAISE NOTICE 'cms_embeddings is not here (no pgvector); wa_match_documents was not created.';
    RETURN;
  END IF;
  EXECUTE $load$SELECT '[1]'::extensions.vector$load$;
  EXECUTE $migration$
CREATE OR REPLACE FUNCTION public.wa_match_documents(
  p_query extensions.vector, p_kinds text[], p_limit integer DEFAULT 20, p_exclude uuid DEFAULT NULL
) RETURNS TABLE (document_id uuid, kind text, slug text, title text, similarity real)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = '' SET hnsw.ef_search = '400' SET hnsw.iterative_scan = 'relaxed_order'
AS $$
  SELECT e.document_id, d.kind, d.slug, d.title, (1 - (e.embedding OPERATOR(extensions.<=>) p_query))::real AS similarity
  FROM public.cms_embeddings e JOIN public.cms_documents d ON d.id = e.document_id
  WHERE e.brand = 'wa' AND e.kind = 'document' AND d.publication_state = 'published' AND d.slug IS NOT NULL
    AND d.kind = ANY (p_kinds) AND (p_exclude IS NULL OR e.document_id <> p_exclude)
  ORDER BY e.embedding OPERATOR(extensions.<=>) p_query
  LIMIT greatest(1, least(coalesce(p_limit, 20), 100));
$$;
REVOKE ALL ON FUNCTION public.wa_match_documents(extensions.vector, text[], integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_match_documents(extensions.vector, text[], integer, uuid) TO service_role;
  $migration$;
END
$outer$;
