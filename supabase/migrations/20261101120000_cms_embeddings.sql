-- Semantic search with pgvector. One embedding per document (title, summary,
-- body) and one per described image (the AI description), kept in Supabase so
-- review data never leaves the database. Service-role only; the search route
-- authorizes publications before matching.

-- Everything below needs pgvector. Databases without it (local test harnesses)
-- skip the semantic index and the search route falls back to lexical search.
DO $outer$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    RAISE NOTICE 'pgvector is not available here; cms_embeddings was not created.';
    RETURN;
  END IF;
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions';
  EXECUTE $migration$

CREATE TABLE IF NOT EXISTS public.cms_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.cms_documents(id) ON DELETE CASCADE,
  brand text NOT NULL CHECK (brand IN ('wa','ws','ca','mw')),
  kind text NOT NULL CHECK (kind IN ('document','media')),
  media_index integer CHECK (media_index IS NULL OR media_index >= 0),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  model text NOT NULL,
  embedding extensions.vector(1024) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cms_embeddings_target_unique
  ON public.cms_embeddings (document_id, kind, coalesce(media_index, -1));
CREATE INDEX IF NOT EXISTS cms_embeddings_brand_kind_idx ON public.cms_embeddings (brand, kind);
CREATE INDEX IF NOT EXISTS cms_embeddings_hnsw_idx
  ON public.cms_embeddings USING hnsw (embedding extensions.vector_cosine_ops);

ALTER TABLE public.cms_embeddings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cms_embeddings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cms_embeddings TO service_role;

CREATE OR REPLACE FUNCTION public.cms_upsert_embedding(
  p_document_id uuid, p_kind text, p_media_index integer, p_content_hash text, p_model text, p_embedding extensions.vector
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_brand text;
BEGIN
  SELECT brand INTO v_brand FROM public.cms_documents WHERE id = p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Document not found'; END IF;
  INSERT INTO public.cms_embeddings (document_id, brand, kind, media_index, content_hash, model, embedding)
    VALUES (p_document_id, v_brand, p_kind, p_media_index, p_content_hash, p_model, p_embedding)
  ON CONFLICT (document_id, kind, coalesce(media_index, -1)) DO UPDATE
    SET brand = EXCLUDED.brand, content_hash = EXCLUDED.content_hash, model = EXCLUDED.model,
        embedding = EXCLUDED.embedding, updated_at = clock_timestamp();
END;
$$;

CREATE OR REPLACE FUNCTION public.cms_match_embeddings(
  p_brands text[], p_query extensions.vector, p_kind text DEFAULT NULL, p_limit integer DEFAULT 20
) RETURNS TABLE (document_id uuid, brand text, kind text, media_index integer, similarity real, title text, publication_state text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT e.document_id, e.brand, e.kind, e.media_index, (1 - (e.embedding OPERATOR(extensions.<=>) p_query))::real AS similarity, d.title, d.publication_state
  FROM public.cms_embeddings e JOIN public.cms_documents d ON d.id = e.document_id
  WHERE e.brand = ANY (p_brands) AND (p_kind IS NULL OR e.kind = p_kind)
  ORDER BY e.embedding OPERATOR(extensions.<=>) p_query
  LIMIT greatest(1, least(coalesce(p_limit, 20), 100));
$$;

-- Which documents still need an embedding (new, or changed since embedding).
CREATE OR REPLACE FUNCTION public.cms_embedding_backlog(p_brands text[], p_limit integer DEFAULT 100)
RETURNS TABLE (document_id uuid, brand text, title text, content_hash text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT d.id, d.brand, d.title,
         encode(extensions.digest(coalesce(d.title, '') || E'\n' || coalesce(d.excerpt, '') || E'\n' || regexp_replace(coalesce(d.body_html, ''), '<[^>]+>', ' ', 'g'), 'sha256'), 'hex') AS content_hash
  FROM public.cms_documents d
  LEFT JOIN public.cms_embeddings e ON e.document_id = d.id AND e.kind = 'document'
  WHERE d.brand = ANY (p_brands)
    AND (e.id IS NULL OR e.content_hash <> encode(extensions.digest(coalesce(d.title, '') || E'\n' || coalesce(d.excerpt, '') || E'\n' || regexp_replace(coalesce(d.body_html, ''), '<[^>]+>', ' ', 'g'), 'sha256'), 'hex'))
  ORDER BY d.updated_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 100), 500));
$$;

REVOKE ALL ON FUNCTION public.cms_upsert_embedding(uuid, text, integer, text, text, extensions.vector) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cms_match_embeddings(text[], extensions.vector, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cms_embedding_backlog(text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_upsert_embedding(uuid, text, integer, text, text, extensions.vector) TO service_role;
GRANT EXECUTE ON FUNCTION public.cms_match_embeddings(text[], extensions.vector, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cms_embedding_backlog(text[], integer) TO service_role;
  $migration$;
END
$outer$;
