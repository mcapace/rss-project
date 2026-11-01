-- One row per Morweb gallery for the CMS Media page: file counts by copy status,
-- total size, and a cover (the first stored image in the gallery's own order).
CREATE OR REPLACE FUNCTION public.cms_media_gallery_summary(p_brand text)
RETURNS TABLE (
  source_gallery_id text, name text, title text, description text, created_at timestamp,
  files bigint, stored bigint, pending bigint, failed bigint, bytes bigint, cover_key text, cover_mime text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT g.source_gallery_id, g.name, g.title, g.description, g.created_at,
    count(f.source_file_id),
    count(f.source_file_id) FILTER (WHERE f.status = 'stored'),
    count(f.source_file_id) FILTER (WHERE f.status = 'pending'),
    count(f.source_file_id) FILTER (WHERE f.status = 'failed'),
    coalesce(sum(coalesce(f.stored_bytes, f.bytes)), 0)::bigint,
    (SELECT c.s3_key FROM public.cms_media_files c
      WHERE c.brand = g.brand AND c.source_gallery_id = g.source_gallery_id AND c.status = 'stored'
        AND c.mime IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
      ORDER BY c.sort_order NULLS LAST, c.file_name LIMIT 1),
    (SELECT c.mime FROM public.cms_media_files c
      WHERE c.brand = g.brand AND c.source_gallery_id = g.source_gallery_id AND c.status = 'stored'
        AND c.mime IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
      ORDER BY c.sort_order NULLS LAST, c.file_name LIMIT 1)
  FROM public.cms_media_galleries g
  LEFT JOIN public.cms_media_files f ON f.brand = g.brand AND f.source_gallery_id = g.source_gallery_id
  WHERE g.brand = p_brand
  GROUP BY g.brand, g.source_gallery_id, g.name, g.title, g.description, g.created_at
$$;
REVOKE ALL ON FUNCTION public.cms_media_gallery_summary(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_media_gallery_summary(text) TO service_role;
