-- Web names for the gallery library: an SEO file name, a title, alt text, a short
-- description and keywords, written by scripts/wa-media-name.ts from the picture
-- itself, its Morweb file name, its gallery and the stories that use it. A search
-- vector over those and the original names lets the CMS find any file by what it
-- shows, and one search function serves the Media page, CMS search and the editor.

ALTER TABLE public.cms_media_files
  ADD COLUMN IF NOT EXISTS seo_name text,
  ADD COLUMN IF NOT EXISTS seo_title text,
  ADD COLUMN IF NOT EXISTS seo_alt text,
  ADD COLUMN IF NOT EXISTS seo_description text,
  ADD COLUMN IF NOT EXISTS keywords text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai jsonb,
  ADD COLUMN IF NOT EXISTS named_at timestamptz,
  ADD COLUMN IF NOT EXISTS search tsvector;

DO $$ BEGIN
  ALTER TABLE public.cms_media_files ADD CONSTRAINT cms_media_files_seo_name_format
    CHECK (seo_name IS NULL OR seo_name ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(seo_name) <= 80);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.cms_media_files_search_vector()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.search :=
    setweight(to_tsvector('english'::regconfig, coalesce(NEW.seo_title, '') || ' ' || coalesce(NEW.title, '') || ' ' || replace(coalesce(NEW.seo_name, ''), '-', ' ')), 'A') ||
    setweight(to_tsvector('english'::regconfig, array_to_string(coalesce(NEW.keywords, '{}'), ' ') || ' ' || coalesce(NEW.ai ->> 'brand', '') || ' ' || coalesce(NEW.ai ->> 'product', '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, coalesce(NEW.seo_alt, '') || ' ' || coalesce(NEW.alt, '') || ' ' || coalesce(NEW.seo_description, '') || ' ' || coalesce(NEW.ai ->> 'visible_text', '')), 'C') ||
    setweight(to_tsvector('english'::regconfig, regexp_replace(coalesce(NEW.file_name, ''), '[_.()\[\]-]+', ' ', 'g')), 'D');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cms_media_files_search ON public.cms_media_files;
CREATE TRIGGER cms_media_files_search BEFORE INSERT OR UPDATE OF file_name, title, alt, seo_name, seo_title, seo_alt, seo_description, keywords, ai
  ON public.cms_media_files FOR EACH ROW EXECUTE FUNCTION public.cms_media_files_search_vector();

-- Fill the vector for the rows already there.
UPDATE public.cms_media_files SET file_name = file_name;

CREATE INDEX IF NOT EXISTS cms_media_files_search_idx ON public.cms_media_files USING gin (search);
CREATE INDEX IF NOT EXISTS cms_media_files_sha_idx ON public.cms_media_files (brand, sha256);
CREATE INDEX IF NOT EXISTS cms_media_files_unnamed_idx ON public.cms_media_files (brand, sha256) WHERE named_at IS NULL AND status = 'stored';

-- One search over the library: words (stemmed, any order, quoted phrases, -exclusions)
-- ranked by where they match, plus a plain substring match on the original and web
-- names so a partial file name still finds its file. Optional gallery and status
-- filters; total is the full match count for paging.
CREATE OR REPLACE FUNCTION public.cms_search_library(
  p_brands text[], p_query text, p_gallery text DEFAULT NULL, p_status text DEFAULT NULL, p_offset integer DEFAULT 0, p_limit integer DEFAULT 60
)
RETURNS TABLE (
  source_gallery_id text, source_file_id text, gallery_title text, file_name text, title text, alt text, mime text,
  width integer, height integer, bytes bigint, stored_bytes bigint, uploaded_at timestamp, source_url text, status text, sha256 text, s3_key text, error text,
  seo_name text, seo_title text, seo_alt text, seo_description text, keywords text[], ai jsonb, brand text, rank real, total bigint
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH q AS (
    SELECT websearch_to_tsquery('english'::regconfig, coalesce(p_query, '')) AS ts,
      '%' || replace(replace(replace(lower(trim(coalesce(p_query, ''))), '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pattern
  ), hits AS (
    SELECT f.*, g.title AS g_title, g.name AS g_name,
      (ts_rank_cd(f.search, q.ts, 1) + CASE WHEN lower(f.file_name) LIKE q.pattern OR coalesce(f.seo_name, '') LIKE replace(q.pattern, ' ', '-') THEN 0.5 ELSE 0 END)::real AS score
    FROM public.cms_media_files f
    CROSS JOIN q
    LEFT JOIN public.cms_media_galleries g ON g.brand = f.brand AND g.source_gallery_id = f.source_gallery_id
    WHERE f.brand = ANY (p_brands)
      AND (p_gallery IS NULL OR f.source_gallery_id = p_gallery)
      AND (p_status IS NULL OR f.status = p_status)
      AND length(trim(coalesce(p_query, ''))) > 0
      AND (f.search @@ q.ts OR lower(f.file_name) LIKE q.pattern OR coalesce(f.seo_name, '') LIKE replace(q.pattern, ' ', '-'))
  )
  SELECT h.source_gallery_id, h.source_file_id, coalesce(nullif(h.g_title, ''), h.g_name), h.file_name, h.title, h.alt, h.mime,
    h.width, h.height, h.bytes, h.stored_bytes, h.uploaded_at, h.source_url, h.status, h.sha256, h.s3_key, h.error,
    h.seo_name, h.seo_title, h.seo_alt, h.seo_description, h.keywords, h.ai, h.brand, h.score, count(*) OVER ()
  FROM hits h
  ORDER BY h.score DESC, h.uploaded_at DESC NULLS LAST, h.file_name
  OFFSET greatest(0, coalesce(p_offset, 0)) LIMIT least(120, greatest(1, coalesce(p_limit, 60)))
$$;
REVOKE ALL ON FUNCTION public.cms_search_library(text[], text, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_search_library(text[], text, text, text, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.cms_media_files_search_vector() FROM PUBLIC, anon, authenticated;
