-- Meaning-based matches only among live Whisky Advocate documents (2026-11-03).
--
-- A story an editor schedules is published with published_at still ahead (cms_publish_document), and the site treats it
-- as live only once that time has come: publication_state = 'published' AND (published_at IS NULL OR published_at <=
-- now()), the rule in src/lib/wa/live.ts. wa_match_documents (20261102200000) checked publication_state alone, so a
-- scheduled story could surface early in search by meaning, answers, Ask and "stories like this". This replaces the
-- function with the same signature, settings and grants and adds the published_at test inside the scan, so a filtered
-- query still fills its limit. The application re-checks every match as well, so it is correct before this is applied.
-- Cheap to apply: it only replaces a function (no table scan, no index build). Safe to run again.
-- The hnsw.* settings exist only once pgvector's library is loaded; using a vector loads it.
-- Databases without pgvector (local test harnesses) have no cms_embeddings table, so this is skipped there,
-- like the semantic index in 20261101120000_cms_embeddings.sql.
DO $outer$
BEGIN
  IF to_regclass('public.cms_embeddings') IS NULL THEN
    RAISE NOTICE 'cms_embeddings is not here (no pgvector); wa_match_documents was not replaced.';
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
    AND (d.published_at IS NULL OR d.published_at <= now())
    AND d.kind = ANY (p_kinds) AND (p_exclude IS NULL OR e.document_id <> p_exclude)
  ORDER BY e.embedding OPERATOR(extensions.<=>) p_query
  LIMIT greatest(1, least(coalesce(p_limit, 20), 100));
$$;
REVOKE ALL ON FUNCTION public.wa_match_documents(extensions.vector, text[], integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_match_documents(extensions.vector, text[], integer, uuid) TO service_role;
  $migration$;
END
$outer$;
