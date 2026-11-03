-- Publishing from the editorial workspace (2026-11-03).
--
-- Ordinary saves still cannot publish (cms_save_document keeps refusing the change), so every story reaches the
-- website through one checked step: cms_publish_document. It fills the slug from the headline when there is none and
-- keeps it unique, stamps published_at (now, or the time an editor scheduled), and records a 'publish' revision.
-- cms_unpublish_document takes a story down and records an 'unpublish' revision; the address keeps its redirect history.
-- Public reads (cms_public_documents and the site's queries) only show a published story once its time has come, so a
-- scheduled story stays hidden until then.

ALTER TABLE public.cms_document_revisions DROP CONSTRAINT IF EXISTS cms_document_revisions_reason_check;
ALTER TABLE public.cms_document_revisions ADD CONSTRAINT cms_document_revisions_reason_check
  CHECK (reason IN ('ingest', 'edit', 'publish', 'unpublish'));

CREATE INDEX IF NOT EXISTS cms_documents_brand_slug_lower_idx ON public.cms_documents (brand, lower(slug)) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS cms_documents_published_at_idx ON public.cms_documents (brand, published_at DESC) WHERE publication_state = 'published' AND published_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.cms_publish_document(p_document_id uuid, p_expected_revision integer, p_publish_at timestamptz, p_actor text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  v_doc public.cms_documents%ROWTYPE;
  v_missing text[] := '{}';
  v_base text;
  v_slug text;
  v_n integer := 1;
  v_when timestamptz;
  v_legacy timestamptz;
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) NOT BETWEEN 1 AND 320 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'An actor is required';
  END IF;
  SELECT * INTO v_doc FROM public.cms_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Document not found';
  END IF;
  IF p_expected_revision IS DISTINCT FROM v_doc.revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'revision_conflict: reload the document before publishing';
  END IF;
  IF v_doc.kind NOT IN ('article', 'legacy_record', 'page') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Only stories and pages publish to the website from here';
  END IF;
  IF coalesce(v_doc.metadata #> '{review,required}' = 'true'::jsonb, false) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A document requiring review cannot be published';
  END IF;
  IF btrim(coalesce(v_doc.title, '')) = '' THEN v_missing := array_append(v_missing, 'a headline'); END IF;
  IF btrim(regexp_replace(coalesce(v_doc.body_html, ''), '<[^>]*>|&nbsp;', '', 'g')) = '' THEN v_missing := array_append(v_missing, 'the story text'); END IF;
  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Before publishing, add ' || array_to_string(v_missing, ' and ');
  END IF;

  -- The address: the editor's slug, else one from the headline; unique within the brand, and never one that an old
  -- address already redirects to a different story.
  v_base := left(btrim(public.cms_slugify(coalesce(nullif(btrim(v_doc.slug), ''), v_doc.title)), '-'), 120);
  IF v_base = '' THEN v_base := 'story-' || left(replace(v_doc.id::text, '-', ''), 8); END IF;
  v_slug := v_base;
  WHILE EXISTS (SELECT 1 FROM public.cms_documents d WHERE d.brand = v_doc.brand AND d.id <> v_doc.id AND lower(d.slug) = lower(v_slug))
     OR EXISTS (SELECT 1 FROM public.cms_redirects r WHERE r.brand = v_doc.brand AND r.document_id IS DISTINCT FROM v_doc.id
                AND lower(rtrim(r.legacy_path, '/')) IN ('/' || lower(v_slug), '/' || v_doc.brand || '/' || lower(v_slug))) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  END LOOP;

  -- The time: the one given (a schedule or a backdate); else the story's first publish time, so taking a story down and
  -- putting it back does not make it new (an imported story's is the old site's date, noon in New York); else now.
  IF coalesce(v_doc.metadata #>> '{legacy_dates,published_date}', '') ~ '^\d{4}-\d{2}-\d{2}' THEN
    v_legacy := (left(v_doc.metadata #>> '{legacy_dates,published_date}', 10)::date + time '12:00') AT TIME ZONE 'America/New_York';
  END IF;
  v_when := coalesce(p_publish_at, v_doc.published_at, v_legacy, clock_timestamp());

  UPDATE public.cms_documents SET
    slug = v_slug,
    publication_state = 'published',
    published_at = v_when,
    metadata = (metadata - 'unpublished_at') || jsonb_build_object('published_by', p_actor),
    revision = revision + 1,
    updated_at = clock_timestamp()
  WHERE id = p_document_id RETURNING * INTO v_doc;
  INSERT INTO public.cms_document_revisions (document_id, revision, snapshot, actor, reason)
    VALUES (v_doc.id, v_doc.revision, to_jsonb(v_doc), p_actor, 'publish');
  RETURN to_jsonb(v_doc);
END;
$$;

CREATE OR REPLACE FUNCTION public.cms_unpublish_document(p_document_id uuid, p_expected_revision integer, p_actor text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE v_doc public.cms_documents%ROWTYPE;
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) NOT BETWEEN 1 AND 320 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'An actor is required';
  END IF;
  SELECT * INTO v_doc FROM public.cms_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Document not found';
  END IF;
  IF p_expected_revision IS DISTINCT FROM v_doc.revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'revision_conflict: reload the document before unpublishing';
  END IF;
  IF v_doc.publication_state <> 'published' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'This document is not published';
  END IF;
  UPDATE public.cms_documents SET
    publication_state = 'unpublished',
    metadata = metadata || jsonb_build_object('unpublished_at', to_jsonb(clock_timestamp()), 'unpublished_by', p_actor),
    revision = revision + 1,
    updated_at = clock_timestamp()
  WHERE id = p_document_id RETURNING * INTO v_doc;
  INSERT INTO public.cms_document_revisions (document_id, revision, snapshot, actor, reason)
    VALUES (v_doc.id, v_doc.revision, to_jsonb(v_doc), p_actor, 'unpublish');
  RETURN to_jsonb(v_doc);
END;
$$;

REVOKE ALL ON FUNCTION public.cms_publish_document(uuid, integer, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cms_unpublish_document(uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_publish_document(uuid, integer, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cms_unpublish_document(uuid, integer, text) TO service_role;

-- Public delivery: a scheduled story is not out until its time.
CREATE OR REPLACE FUNCTION public.cms_public_documents(p_brand text, p_kind text DEFAULT NULL::text, p_section text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(id uuid, brand text, kind text, title text, byline text, excerpt text, slug text, canonical_path text, published_at timestamp with time zone, updated_at timestamp with time zone, metadata jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT d.id, d.brand, d.kind, d.title, d.byline, d.excerpt, d.slug, public.cms_canonical_path(d), d.published_at, d.updated_at,
         (d.metadata - 'media' - 'warnings' - 'review' - 'migration' - 'organization')
         || jsonb_build_object('media', coalesce(d.metadata -> 'media', '[]'::jsonb))
  FROM public.cms_documents d
  WHERE d.brand = p_brand AND d.publication_state = 'published'
    AND (d.published_at IS NULL OR d.published_at <= now())
    AND (p_kind IS NULL OR d.kind = p_kind)
    AND (p_section IS NULL OR d.metadata ->> 'section' = p_section)
    AND (p_before IS NULL OR coalesce(d.published_at, d.updated_at) < p_before)
  ORDER BY coalesce(d.published_at, d.updated_at) DESC
  LIMIT greatest(1, least(coalesce(p_limit, 20), 100));
$function$;
