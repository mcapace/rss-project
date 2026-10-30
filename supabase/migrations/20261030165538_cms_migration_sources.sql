-- Private, inert evidence from a captured content archive. These records are not
-- editable CMS documents and must never be rendered as executable page blocks.
-- Account/credential collections are deliberately absent from the allowlist.
CREATE TABLE public.cms_migration_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL CHECK (brand IN ('wa', 'ws', 'ca', 'mw')),
  archive_sha256 text NOT NULL CHECK (archive_sha256 ~ '^[0-9a-f]{64}$'),
  source_kind text NOT NULL CHECK (source_kind IN (
    'post_version', 'page_version', 'page_context', 'category', 'tag', 'page_group',
    'gallery_definition', 'gallery_version', 'media_file', 'gallery_membership',
    'menu_definition', 'menu_item', 'menu_payload', 'media_response_context',
    'menu_response_context', 'capture_manifest', 'source_context',
    'page_editor_capture', 'rendered_page_snapshot', 'editor_diagnostic',
    'cms_index_document', 'cms_inventory_document', 'menu_embedded_page_snapshot',
    'source_part'
  )),
  source_key text NOT NULL CHECK (length(btrim(source_key)) BETWEEN 1 AND 512),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  -- Optional digest of the original serialized source, distinct from this row's
  -- canonical JSON payload digest. Required for split-source parts.
  source_sha256 text CHECK (source_sha256 IS NULL OR source_sha256 ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) IN ('object', 'array')),
  captured_at timestamptz,
  actor text NOT NULL CHECK (length(btrim(actor)) BETWEEN 1 AND 320),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_kind <> 'source_part' OR source_sha256 IS NOT NULL),
  UNIQUE (brand, archive_sha256, source_kind, source_key, payload_sha256)
);
CREATE INDEX cms_migration_sources_lookup_idx
  ON public.cms_migration_sources (brand, source_kind, source_key, created_at, id);

ALTER TABLE public.cms_migration_sources ENABLE ROW LEVEL SECURITY;
-- Remove Supabase's broad service_role default ACL before granting the exact
-- append-only contract. A row trigger alone would not prevent TRUNCATE.
REVOKE ALL ON public.cms_migration_sources FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.cms_migration_sources TO service_role;

CREATE FUNCTION public.cms_guard_migration_source()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_nodes bigint;
  v_depth integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Migration source history is append-only';
  END IF;
  IF jsonb_typeof(NEW.payload) NOT IN ('object', 'array') OR
    NEW.payload IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A source payload must be a JSON object or array';
  END IF;
  IF octet_length(NEW.payload::text) > 2097152 THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'Source payload exceeds 2 MiB; preserve it as explicit parts with a reassembly manifest';
  END IF;
  -- Count value nodes (root included), with bounded recursion/work. Oversized
  -- wrappers use source_part rows instead of losing fields or nested captures.
  WITH RECURSIVE nodes(value, depth) AS (
    SELECT NEW.payload, 0
    UNION ALL
    SELECT child.value, parent.depth + 1
      FROM nodes parent
      CROSS JOIN LATERAL (
        SELECT value FROM jsonb_each(CASE WHEN jsonb_typeof(parent.value) = 'object' THEN parent.value ELSE '{}'::jsonb END)
        UNION ALL
        SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(parent.value) = 'array' THEN parent.value ELSE '[]'::jsonb END)
      ) child
      WHERE parent.depth < 64
  )
  SELECT count(*), max(depth) INTO v_nodes, v_depth
    FROM (SELECT depth FROM nodes LIMIT 100001) bounded_nodes;
  IF v_nodes > 100000 OR v_depth >= 64 THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'Source payload exceeds 100000 value nodes or 64 nesting levels; preserve it as explicit parts';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cms_migration_sources_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.cms_migration_sources
  FOR EACH ROW EXECUTE FUNCTION public.cms_guard_migration_source();
REVOKE ALL ON FUNCTION public.cms_guard_migration_source() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_guard_migration_source() TO service_role;

-- One immutable insert or an exact idempotent match. A reused declared hash
-- never hides different payloads, capture timestamps, or original digests.
CREATE FUNCTION public.cms_ingest_migration_source(
  p_source jsonb,
  p_actor text DEFAULT 'archive-importer'
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_source public.cms_migration_sources%ROWTYPE;
  v_key text;
  v_captured_at timestamptz;
  v_action text;
BEGIN
  IF jsonb_typeof(p_source) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Migration source must be an object';
  END IF;
  IF p_actor IS NULL OR length(btrim(p_actor)) NOT BETWEEN 1 AND 320 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'An actor is required';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_source) LOOP
    IF v_key NOT IN ('brand', 'archive_sha256', 'source_kind', 'source_key',
      'payload_sha256', 'source_sha256', 'payload', 'captured_at') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Unsupported migration source field: ' || v_key;
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['brand', 'archive_sha256', 'source_kind', 'source_key', 'payload_sha256'] LOOP
    IF jsonb_typeof(p_source -> v_key) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Missing or invalid source field: ' || v_key;
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['source_sha256', 'captured_at'] LOOP
    IF p_source ? v_key AND jsonb_typeof(p_source -> v_key) NOT IN ('string', 'null') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid nullable source field: ' || v_key;
    END IF;
  END LOOP;
  IF p_source ->> 'captured_at' IS NOT NULL THEN
    IF p_source ->> 'captured_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Capture timestamps require an explicit timezone';
    END IF;
    v_captured_at := (p_source ->> 'captured_at')::timestamptz;
  END IF;
  INSERT INTO public.cms_migration_sources (
    brand, archive_sha256, source_kind, source_key, payload_sha256,
    source_sha256, payload, captured_at, actor
  ) VALUES (
    p_source ->> 'brand', p_source ->> 'archive_sha256', p_source ->> 'source_kind',
    p_source ->> 'source_key', p_source ->> 'payload_sha256',
    p_source ->> 'source_sha256', p_source -> 'payload', v_captured_at, p_actor
  ) ON CONFLICT (brand, archive_sha256, source_kind, source_key, payload_sha256)
    DO NOTHING RETURNING * INTO v_source;
  IF FOUND THEN
    v_action := 'created';
  ELSE
    SELECT * INTO v_source FROM public.cms_migration_sources
      WHERE brand = p_source ->> 'brand' AND archive_sha256 = p_source ->> 'archive_sha256'
        AND source_kind = p_source ->> 'source_kind' AND source_key = p_source ->> 'source_key'
        AND payload_sha256 = p_source ->> 'payload_sha256';
    IF v_source.payload IS DISTINCT FROM p_source -> 'payload' OR
      v_source.source_sha256 IS DISTINCT FROM p_source ->> 'source_sha256' OR
      v_source.captured_at IS DISTINCT FROM v_captured_at THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'source_hash_collision: immutable source identity/hash has different captured data';
    END IF;
    v_action := 'unchanged';
  END IF;
  RETURN jsonb_build_object('id', v_source.id, 'action', v_action, 'brand', v_source.brand,
    'archive_sha256', v_source.archive_sha256, 'source_kind', v_source.source_kind,
    'source_key', v_source.source_key, 'payload_sha256', v_source.payload_sha256);
END;
$$;
REVOKE ALL ON FUNCTION public.cms_ingest_migration_source(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_ingest_migration_source(jsonb, text) TO service_role;

-- Aggregate private coverage without returning raw archived payloads. The
-- authenticated server endpoint must authorize p_brand before calling this RPC.
CREATE FUNCTION public.cms_migration_inventory(p_brand text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_inventory jsonb;
BEGIN
  IF p_brand IS NULL OR p_brand NOT IN ('wa', 'ws', 'ca', 'mw') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Choose a supported publication';
  END IF;
  WITH documents AS MATERIALIZED (
    SELECT kind, publication_state, source_system,
      coalesce(metadata #> '{review,required}' = 'true'::jsonb, false) AS review_required,
      coalesce(kind = 'page' AND metadata #> '{review,required}' = 'true'::jsonb AND
        (metadata #> '{review,reasons}') ? 'page_body_assembly_required', false) AS awaiting_assembly
      FROM public.cms_documents WHERE brand = p_brand
  ), sources AS MATERIALIZED (
    SELECT source_kind, archive_sha256 FROM public.cms_migration_sources WHERE brand = p_brand
  )
  SELECT jsonb_build_object(
    'brand', p_brand,
    'documents', jsonb_build_object(
      'total', (SELECT count(*) FROM documents),
      'by_kind', (SELECT jsonb_object_agg(expected.kind, coalesce(actual.n, 0))
        FROM (VALUES ('article'), ('rating'), ('page'), ('glossary_entry'), ('directory_entry'),
          ('collection_entry'), ('product_review'), ('legacy_record')) expected(kind)
        LEFT JOIN (SELECT kind, count(*) n FROM documents GROUP BY kind) actual USING (kind)),
      'by_publication_state', (SELECT jsonb_object_agg(expected.publication_state, coalesce(actual.n, 0))
        FROM (VALUES ('draft'), ('review'), ('published'), ('unpublished')) expected(publication_state)
        LEFT JOIN (SELECT publication_state, count(*) n FROM documents GROUP BY publication_state) actual USING (publication_state)),
      'by_source_system', (SELECT jsonb_object_agg(expected.source_system, coalesce(actual.n, 0))
        FROM (VALUES ('morweb'), ('print'), ('manual')) expected(source_system)
        LEFT JOIN (SELECT source_system, count(*) n FROM documents GROUP BY source_system) actual USING (source_system)),
      'review_required', (SELECT count(*) FROM documents WHERE review_required),
      'pages_awaiting_assembly', (SELECT count(*) FROM documents WHERE awaiting_assembly)
    ),
    'sources', jsonb_build_object(
      'total', (SELECT count(*) FROM sources),
      'archive_count', (SELECT count(DISTINCT archive_sha256) FROM sources),
      'by_source_kind', (SELECT jsonb_object_agg(expected.source_kind, coalesce(actual.n, 0))
        FROM (VALUES ('post_version'), ('page_version'), ('page_context'), ('category'), ('tag'),
          ('page_group'), ('gallery_definition'), ('gallery_version'), ('media_file'), ('gallery_membership'),
          ('menu_definition'), ('menu_item'), ('menu_payload'), ('media_response_context'),
          ('menu_response_context'), ('capture_manifest'), ('source_context'), ('page_editor_capture'),
          ('rendered_page_snapshot'), ('editor_diagnostic'), ('cms_index_document'),
          ('cms_inventory_document'), ('menu_embedded_page_snapshot'), ('source_part')) expected(source_kind)
        LEFT JOIN (SELECT source_kind, count(*) n FROM sources GROUP BY source_kind) actual USING (source_kind))
    )
  ) INTO v_inventory;
  RETURN v_inventory;
END;
$$;
REVOKE ALL ON FUNCTION public.cms_migration_inventory(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_migration_inventory(text) TO service_role;
