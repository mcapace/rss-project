-- Canonical editorial content. This migration is additive: the existing RSS
-- tables/feed continue to exist, but print ingestion no longer publishes them.
-- Apply to a development database first. No archive content is embedded here.

-- Each dispatch carries this lease into the worker. A delayed worker from an
-- earlier retry must never finalize or fail a newer issue run.
ALTER TABLE public.issues ADD COLUMN cms_intake_token uuid;
ALTER TABLE public.issues ADD COLUMN cms_queued_at timestamptz;

CREATE FUNCTION public.cms_queue_issue(
  p_brand text,
  p_issue_id text,
  p_issue_label text,
  p_pdf_key text,
  p_toc_pages integer[] DEFAULT ARRAY[3,4]
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_issue public.issues%ROWTYPE;
BEGIN
  IF p_brand IS NULL OR p_brand NOT IN ('wa','ws','ca','mw')
    OR p_issue_id IS NULL OR p_issue_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
    OR p_issue_label IS NULL OR length(btrim(p_issue_label)) NOT BETWEEN 1 AND 500
    OR p_pdf_key IS NULL OR p_pdf_key NOT LIKE 'pdfs/inbox/%'
    OR length(p_pdf_key) > 1024 OR p_pdf_key LIKE '%..%'
    OR p_pdf_key ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid print issue input';
  END IF;
  IF p_toc_pages IS NULL OR cardinality(p_toc_pages) NOT BETWEEN 1 AND 20
    OR EXISTS (SELECT 1 FROM unnest(p_toc_pages) page WHERE page IS NULL OR page NOT BETWEEN 1 AND 10000) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid table-of-contents page selection';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    jsonb_build_array('cms_queue_issue', p_brand, p_issue_id)::text, 0));
  SELECT * INTO v_issue FROM public.issues WHERE brand = p_brand AND issue_id = p_issue_id FOR UPDATE;
  IF FOUND THEN
    IF v_issue.status IS NULL OR v_issue.status NOT IN ('review','failed') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Issue is already active or published';
    END IF;
    UPDATE public.issues SET issue_label = p_issue_label, pdf_key = p_pdf_key,
      toc_pages = p_toc_pages, status = 'queued', error = NULL,
      cms_intake_token = gen_random_uuid(), cms_queued_at = clock_timestamp()
      WHERE id = v_issue.id RETURNING * INTO v_issue;
  ELSE
    INSERT INTO public.issues (brand,issue_id,issue_label,pdf_key,toc_pages,status,cms_intake_token,cms_queued_at)
      VALUES (p_brand,p_issue_id,p_issue_label,p_pdf_key,p_toc_pages,'queued',gen_random_uuid(),clock_timestamp())
      RETURNING * INTO v_issue;
  END IF;
  RETURN to_jsonb(v_issue);
END;
$$;
REVOKE ALL ON FUNCTION public.cms_queue_issue(text,text,text,text,integer[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_queue_issue(text,text,text,text,integer[]) TO service_role;

CREATE TABLE public.cms_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL CHECK (brand IN ('wa', 'ws', 'ca', 'mw')),
  kind text NOT NULL CHECK (kind IN ('article', 'rating', 'page')),
  source_system text NOT NULL CHECK (source_system IN ('morweb', 'print', 'manual')),
  source_key text NOT NULL CHECK (length(btrim(source_key)) BETWEEN 1 AND 512),
  source_hash text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  identity_anchor jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(identity_anchor) = 'object'),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 1000),
  byline text NOT NULL DEFAULT '',
  body_html text NOT NULL DEFAULT '',
  excerpt text NOT NULL DEFAULT '',
  slug text,
  public_url text CHECK (public_url IS NULL OR public_url ~ '^https?://[^[:space:]]+$'),
  publication_state text NOT NULL DEFAULT 'review'
    CHECK (publication_state IN ('draft', 'review', 'published', 'unpublished')),
  published_at timestamptz,
  issue_uuid uuid REFERENCES public.issues(id) ON DELETE RESTRICT,
  metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand, kind, source_system, source_key)
);

-- Never resolve legacy alias collisions by overwriting another document.
-- Keep URL path case as supplied; migration preflight handles normalization.
CREATE UNIQUE INDEX cms_documents_public_url_unique
  ON public.cms_documents (brand, public_url) WHERE public_url IS NOT NULL;
-- Morweb source keys include their collection (Posts:/Pages:). Reclassifying
-- one captured record must be an explicit mapping decision, never a new copy.
CREATE UNIQUE INDEX cms_documents_morweb_source_unique
  ON public.cms_documents (brand, source_system, source_key) WHERE source_system = 'morweb';
CREATE INDEX cms_documents_library_idx
  ON public.cms_documents (brand, kind, publication_state, updated_at DESC, id);
CREATE INDEX cms_documents_issue_idx ON public.cms_documents (issue_uuid);

CREATE TABLE public.cms_source_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.cms_documents(id) ON DELETE RESTRICT,
  source_hash text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, source_hash)
);
CREATE INDEX cms_source_snapshots_document_idx
  ON public.cms_source_snapshots (document_id, created_at DESC, id);

CREATE TABLE public.cms_document_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.cms_documents(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  actor text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('ingest', 'edit')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, revision)
);

-- These are editorial/private records, even where a migrated item is marked
-- published. A future public delivery API needs its own explicit contract.
ALTER TABLE public.cms_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_source_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_document_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cms_documents, public.cms_source_snapshots,
  public.cms_document_revisions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.cms_documents TO service_role;
GRANT SELECT, INSERT ON public.cms_source_snapshots, public.cms_document_revisions TO service_role;

CREATE FUNCTION public.cms_reject_history_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'CMS history is append-only';
END;
$$;
CREATE TRIGGER cms_source_snapshots_immutable
  BEFORE UPDATE OR DELETE ON public.cms_source_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.cms_reject_history_mutation();
CREATE TRIGGER cms_document_revisions_immutable
  BEFORE UPDATE OR DELETE ON public.cms_document_revisions
  FOR EACH ROW EXECUTE FUNCTION public.cms_reject_history_mutation();
REVOKE ALL ON FUNCTION public.cms_reject_history_mutation() FROM PUBLIC, anon, authenticated;

-- One transaction creates a document + original source + first editorial
-- revision. Subsequent source changes become candidates and never replace
-- editor text, selected media, taxonomy, URL, or publication state.
CREATE FUNCTION public.cms_ingest_document(
  p_document jsonb,
  p_actor text DEFAULT 'importer'
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_doc public.cms_documents%ROWTYPE;
  v_snapshot public.cms_source_snapshots%ROWTYPE;
  v_created boolean := false;
  v_action text;
  v_key text;
  v_state text;
  v_issue uuid;
  v_issue_brand text;
  v_payload jsonb;
  v_anchor jsonb;
BEGIN
  IF jsonb_typeof(p_document) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Document must be an object';
  END IF;
  IF p_actor IS NULL OR length(btrim(p_actor)) NOT BETWEEN 1 AND 320 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'An actor is required';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['brand','kind','source_system','source_key','source_hash','title','body_html'] LOOP
    IF jsonb_typeof(p_document -> v_key) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Missing or invalid field: ' || v_key;
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['byline','excerpt','publication_state'] LOOP
    IF p_document ? v_key AND jsonb_typeof(p_document -> v_key) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid text field: ' || v_key;
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['slug','public_url','published_at','issue_uuid'] LOOP
    IF p_document ? v_key AND jsonb_typeof(p_document -> v_key) NOT IN ('string', 'null') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid nullable field: ' || v_key;
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['metadata','identity_anchor','source_payload'] LOOP
    IF p_document ? v_key AND jsonb_typeof(p_document -> v_key) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid object field: ' || v_key;
    END IF;
  END LOOP;
  IF p_document ->> 'source_hash' !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'source_hash must be a lowercase SHA-256';
  END IF;

  v_issue := nullif(p_document ->> 'issue_uuid', '')::uuid;
  IF v_issue IS NOT NULL THEN
    SELECT brand INTO v_issue_brand FROM public.issues WHERE id = v_issue;
    IF NOT FOUND OR v_issue_brand IS DISTINCT FROM p_document ->> 'brand' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Issue does not belong to document brand';
    END IF;
  END IF;
  v_anchor := coalesce(p_document -> 'identity_anchor', '{}'::jsonb);
  IF p_document ->> 'source_system' = 'print' AND (v_issue IS NULL OR v_anchor = '{}'::jsonb) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Print input requires an issue and identity anchor';
  END IF;

  -- Serialize competing creates of the same source identity. The table's
  -- unique constraint remains the authoritative collision protection.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    jsonb_build_array(p_document ->> 'brand', p_document ->> 'kind',
      p_document ->> 'source_system', p_document ->> 'source_key')::text, 0));
  SELECT * INTO v_doc FROM public.cms_documents
    WHERE brand = p_document ->> 'brand' AND kind = p_document ->> 'kind'
      AND source_system = p_document ->> 'source_system'
      AND source_key = p_document ->> 'source_key'
    FOR UPDATE;

  IF NOT FOUND THEN
    v_state := CASE p_document ->> 'source_system'
      WHEN 'print' THEN 'review'
      WHEN 'manual' THEN 'draft'
      ELSE coalesce(p_document ->> 'publication_state', 'review') END;
    INSERT INTO public.cms_documents (
      brand, kind, source_system, source_key, source_hash, identity_anchor,
      title, byline, body_html, excerpt, slug, public_url, publication_state,
      published_at, issue_uuid, metadata
    ) VALUES (
      p_document ->> 'brand', p_document ->> 'kind', p_document ->> 'source_system',
      p_document ->> 'source_key', p_document ->> 'source_hash', v_anchor,
      p_document ->> 'title', coalesce(p_document ->> 'byline', ''),
      p_document ->> 'body_html', coalesce(p_document ->> 'excerpt', ''),
      nullif(p_document ->> 'slug', ''), nullif(p_document ->> 'public_url', ''), v_state,
      CASE WHEN p_document ->> 'source_system' = 'morweb'
        THEN nullif(p_document ->> 'published_at', '')::timestamptz ELSE NULL END,
      v_issue, coalesce(p_document -> 'metadata', '{}'::jsonb)
    ) RETURNING * INTO v_doc;
    v_created := true;
  ELSIF v_doc.identity_anchor IS DISTINCT FROM v_anchor OR v_doc.issue_uuid IS DISTINCT FROM v_issue THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Source identity anchor changed; review the mapping';
  END IF;

  v_payload := p_document - 'source_hash';
  INSERT INTO public.cms_source_snapshots (document_id, source_hash, payload, actor)
    VALUES (v_doc.id, p_document ->> 'source_hash', v_payload, p_actor)
    ON CONFLICT (document_id, source_hash) DO NOTHING
    RETURNING * INTO v_snapshot;
  IF NOT FOUND THEN
    SELECT * INTO v_snapshot FROM public.cms_source_snapshots
      WHERE document_id = v_doc.id AND source_hash = p_document ->> 'source_hash';
    IF v_snapshot.payload IS DISTINCT FROM v_payload THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'source_hash_collision: same hash has different source content';
    END IF;
    v_action := 'unchanged';
  ELSE
    v_action := CASE WHEN v_created THEN 'created' ELSE 'candidate' END;
  END IF;
  IF v_created THEN
    INSERT INTO public.cms_document_revisions (document_id, revision, snapshot, actor, reason)
      VALUES (v_doc.id, v_doc.revision, to_jsonb(v_doc), p_actor, 'ingest');
  END IF;
  RETURN jsonb_build_object('document_id', v_doc.id, 'action', v_action,
    'revision', v_doc.revision, 'source_snapshot_id', v_snapshot.id);
END;
$$;

-- Commit an entire issue's candidates and its review status together. No
-- legacy articles are deleted/updated, and no RSS publication is triggered.
CREATE FUNCTION public.cms_ingest_print_issue(
  p_issue_uuid uuid,
  p_documents jsonb,
  p_actor text DEFAULT 'print-worker',
  p_intake_token uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_issue public.issues%ROWTYPE;
  v_input jsonb;
  v_results jsonb := '[]'::jsonb;
  v_warning_count integer := 0;
BEGIN
  IF jsonb_typeof(p_documents) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Issue documents must be an array';
  END IF;
  IF jsonb_array_length(p_documents) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Issue must contain between 1 and 1000 documents';
  END IF;
  SELECT * INTO v_issue FROM public.issues WHERE id = p_issue_uuid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Issue not found';
  END IF;
  IF v_issue.status = 'published' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Published legacy issue cannot be reprocessed by print intake';
  END IF;
  IF v_issue.cms_intake_token IS NOT NULL AND v_issue.cms_intake_token IS DISTINCT FROM p_intake_token THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'intake_conflict: print run was superseded or has no valid lease';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_documents) item
    GROUP BY item ->> 'source_key' HAVING count(*) > 1) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Duplicate source identity in print issue';
  END IF;
  FOR v_input IN SELECT value FROM jsonb_array_elements(p_documents) ORDER BY value ->> 'source_key' LOOP
    IF v_input ->> 'source_system' IS DISTINCT FROM 'print'
      OR v_input ->> 'kind' IS DISTINCT FROM 'article'
      OR v_input ->> 'brand' IS DISTINCT FROM v_issue.brand
      OR v_input ->> 'issue_uuid' IS DISTINCT FROM p_issue_uuid::text THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Print document does not match the issue';
    END IF;
    v_results := v_results || jsonb_build_array(public.cms_ingest_document(v_input, p_actor));
    IF jsonb_typeof(v_input #> '{metadata,warnings}') = 'array' THEN
      v_warning_count := v_warning_count + jsonb_array_length(v_input #> '{metadata,warnings}');
    END IF;
  END LOOP;
  UPDATE public.issues SET status = 'review', error = NULL,
    stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object(
      'cms_document_count', jsonb_array_length(p_documents),
      'review_required', true, 'warning_count', v_warning_count)
    WHERE id = p_issue_uuid;
  RETURN jsonb_build_object('issue_uuid', p_issue_uuid, 'documents', v_results);
END;
$$;

CREATE FUNCTION public.cms_save_document(
  p_document_id uuid,
  p_expected_revision integer,
  p_patch jsonb,
  p_actor text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_doc public.cms_documents%ROWTYPE;
  v_next public.cms_documents%ROWTYPE;
  v_key text;
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) NOT BETWEEN 1 AND 320 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'An actor is required';
  END IF;
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Edit must be a nonempty object';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN ('title','byline','body_html','excerpt','slug','public_url','metadata','publication_state') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Field is not editable: ' || v_key;
    END IF;
    IF v_key = 'metadata' THEN
      IF jsonb_typeof(p_patch -> v_key) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'metadata must be an object';
      END IF;
    ELSIF v_key IN ('slug','public_url') THEN
      IF jsonb_typeof(p_patch -> v_key) NOT IN ('string','null') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid nullable field: ' || v_key;
      END IF;
    ELSIF jsonb_typeof(p_patch -> v_key) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid text field: ' || v_key;
    END IF;
  END LOOP;
  SELECT * INTO v_doc FROM public.cms_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Document not found';
  END IF;
  IF p_expected_revision IS DISTINCT FROM v_doc.revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'revision_conflict: reload the document before saving';
  END IF;
  IF p_patch ->> 'publication_state' = 'published' AND v_doc.publication_state <> 'published' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Publishing is not enabled in this editorial foundation';
  END IF;
  -- Merge metadata at the top level so an SEO edit does not erase unrelated
  -- migration, media or ratings data. Nested objects are supplied complete.
  IF p_patch ? 'metadata' THEN
    p_patch := jsonb_set(p_patch, '{metadata}', v_doc.metadata || (p_patch -> 'metadata'));
  END IF;
  v_next := jsonb_populate_record(v_doc, p_patch);
  UPDATE public.cms_documents SET title = v_next.title, byline = v_next.byline,
    body_html = v_next.body_html, excerpt = v_next.excerpt,
    slug = nullif(v_next.slug, ''), public_url = nullif(v_next.public_url, ''),
    metadata = v_next.metadata, publication_state = v_next.publication_state,
    revision = revision + 1, updated_at = clock_timestamp()
    WHERE id = p_document_id RETURNING * INTO v_doc;
  INSERT INTO public.cms_document_revisions (document_id, revision, snapshot, actor, reason)
    VALUES (v_doc.id, v_doc.revision, to_jsonb(v_doc), p_actor, 'edit');
  RETURN to_jsonb(v_doc);
END;
$$;

-- Postgres grants EXECUTE to PUBLIC by default; explicitly close every RPC.
-- Server handlers must independently authenticate and authorize users before
-- using their server-only service role client to call these functions.
REVOKE ALL ON FUNCTION public.cms_ingest_document(jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cms_ingest_print_issue(uuid, jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cms_save_document(uuid, integer, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_ingest_document(jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cms_ingest_print_issue(uuid, jsonb, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cms_save_document(uuid, integer, jsonb, text) TO service_role;
