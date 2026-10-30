-- Bounded transport optimization for archive preservation. Each source still
-- passes the existing immutable insert/idempotency checks, in one transaction.
CREATE FUNCTION public.cms_ingest_migration_sources_batch(
  p_sources jsonb,
  p_actor text DEFAULT 'archive-importer'
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_item jsonb;
  v_results jsonb := '[]'::jsonb;
  v_brand text;
  v_archive text;
BEGIN
  IF jsonb_typeof(p_sources) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A source batch must be an array';
  END IF;
  IF jsonb_array_length(p_sources) NOT BETWEEN 1 AND 100 OR
    octet_length(p_sources::text) > 4194304 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A source batch must contain 1 to 100 rows and fit within 4 MiB';
  END IF;
  v_brand := p_sources #>> '{0,brand}';
  v_archive := p_sources #>> '{0,archive_sha256}';
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_sources) WITH ORDINALITY ORDER BY ordinality LOOP
    IF v_item ->> 'brand' IS DISTINCT FROM v_brand OR
      v_item ->> 'archive_sha256' IS DISTINCT FROM v_archive THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Every source in a batch must belong to the same publication and archive';
    END IF;
    v_results := v_results || jsonb_build_array(public.cms_ingest_migration_source(v_item, p_actor));
  END LOOP;
  RETURN v_results;
END;
$$;
REVOKE ALL ON FUNCTION public.cms_ingest_migration_sources_batch(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_ingest_migration_sources_batch(jsonb, text) TO service_role;
