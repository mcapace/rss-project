-- The Morweb gallery library, kept as a browsable catalog in the CMS (/cms/media).
-- Every gallery and every uploaded file is recorded from the migration archive
-- (cms_migration_sources: gallery_definition, media_file). Each file is copied
-- once into the shared, content-addressed store (S3 cms/legacy/<brand>/<sha256>.<ext>,
-- the same store story images and /api/wa/asset use) by scripts/wa-gallery-import.ts;
-- status says whether that copy exists yet.

CREATE TABLE IF NOT EXISTS public.cms_media_galleries (
  brand text NOT NULL,
  source_gallery_id text NOT NULL,
  name text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  file_count integer NOT NULL DEFAULT 0 CHECK (file_count >= 0),
  created_at timestamp,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (brand, source_gallery_id)
);

CREATE TABLE IF NOT EXISTS public.cms_media_files (
  brand text NOT NULL,
  source_gallery_id text NOT NULL,
  source_file_id text NOT NULL,
  file_name text NOT NULL,
  title text NOT NULL DEFAULT '',
  alt text NOT NULL DEFAULT '',
  mime text NOT NULL DEFAULT '',
  width integer,
  height integer,
  bytes bigint,
  sort_order integer,
  uploaded_at timestamp,
  source_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'stored', 'failed')),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
  s3_key text,
  stored_bytes bigint,
  stored_at timestamptz,
  error text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (brand, source_gallery_id, source_file_id),
  CHECK (status <> 'stored' OR (sha256 IS NOT NULL AND s3_key IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS cms_media_files_gallery_idx ON public.cms_media_files (brand, source_gallery_id, sort_order, file_name);
CREATE INDEX IF NOT EXISTS cms_media_files_status_idx ON public.cms_media_files (brand, status);
CREATE INDEX IF NOT EXISTS cms_media_files_sha_idx ON public.cms_media_files (sha256) WHERE sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS cms_media_files_name_idx ON public.cms_media_files (brand, lower(file_name));

ALTER TABLE public.cms_media_galleries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_media_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cms_media_galleries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cms_media_files FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.cms_media_galleries TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.cms_media_files TO service_role;

-- The stories that use given files, matched by content hash or, for files not
-- copied yet, by the Morweb file name in the story image's source URL.
CREATE OR REPLACE FUNCTION public.cms_media_file_usage(p_brand text, p_sha256 text[], p_names text[])
RETURNS TABLE (sha256 text, file_name text, document_id uuid, title text, publication_state text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT DISTINCT
    CASE WHEN item ->> 'sha256' = ANY (p_sha256) THEN item ->> 'sha256' END,
    lower(regexp_replace(coalesce(item ->> 'source_url', ''), '^.*/', '')),
    d.id, d.title, d.publication_state
  FROM public.cms_documents d
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.metadata -> 'media') = 'array' THEN d.metadata -> 'media' ELSE '[]'::jsonb END) AS item
  WHERE d.brand = p_brand
    AND (item ->> 'sha256' = ANY (p_sha256)
      OR (coalesce(item ->> 'source_url', '') ~ '/galleries/'
        AND lower(regexp_replace(coalesce(item ->> 'source_url', ''), '^.*/', '')) = ANY (p_names)))
$$;
REVOKE ALL ON FUNCTION public.cms_media_file_usage(text, text[], text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_media_file_usage(text, text[], text[]) TO service_role;
