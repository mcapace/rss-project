-- Retain observed content from separate public publication applications. This
-- adds no content, changes no existing documents/history, and grants no access.
ALTER TABLE public.cms_documents
  DROP CONSTRAINT cms_documents_source_system_check,
  ADD CONSTRAINT cms_documents_source_system_check CHECK (
    source_system IN ('morweb', 'print', 'manual', 'web_archive')
  ),
  ADD CONSTRAINT cms_documents_web_archive_review_check CHECK (
    source_system <> 'web_archive' OR
    coalesce(metadata #> '{review,required}' = 'true'::jsonb, false)
  );

-- cms_guard_retained_document already validates nonempty reason codes, forces
-- a gated INSERT to review with no publication timestamp, and rejects ordinary
-- edits that remove/change the gate or publish the document. The extra CHECK
-- makes the gate mandatory for every new web_archive source.

-- A source key includes its application/edition namespace. Changing its mapped
-- content kind must never create a second document for that same source.
CREATE UNIQUE INDEX cms_documents_web_archive_source_unique
  ON public.cms_documents (brand, source_system, source_key)
  WHERE source_system = 'web_archive';

CREATE OR REPLACE FUNCTION public.cms_migration_inventory(p_brand text)
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
        FROM (VALUES ('morweb'), ('print'), ('manual'), ('web_archive')) expected(source_system)
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
