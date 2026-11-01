-- The dedicated review-resolution workflow the retained-content guard calls
-- for. Ordinary saves still cannot touch a review gate. cms_resolve_review
-- clears a gate for one document, may publish it in the same step, and leaves
-- an append-only audit row naming the actor, the cleared reasons and the note.

CREATE TABLE IF NOT EXISTS public.cms_review_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.cms_documents(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  previous_review jsonb NOT NULL CHECK (jsonb_typeof(previous_review) = 'object'),
  previous_state text NOT NULL,
  next_state text NOT NULL,
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 2000),
  actor text NOT NULL CHECK (length(btrim(actor)) BETWEEN 1 AND 320),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cms_review_resolutions_document_idx ON public.cms_review_resolutions (document_id, created_at DESC);
ALTER TABLE public.cms_review_resolutions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cms_review_resolutions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.cms_review_resolutions TO service_role;
DROP TRIGGER IF EXISTS cms_review_resolutions_immutable ON public.cms_review_resolutions;
CREATE TRIGGER cms_review_resolutions_immutable
  BEFORE UPDATE OR DELETE ON public.cms_review_resolutions
  FOR EACH ROW EXECUTE FUNCTION public.cms_reject_history_mutation();

-- Every new web_archive capture still arrives gated; the guard below enforces
-- that on insert, and only cms_resolve_review can lift the gate afterwards.
ALTER TABLE public.cms_documents DROP CONSTRAINT IF EXISTS cms_documents_web_archive_review_check;

-- Same guard as before, except inside cms_resolve_review, which sets a
-- transaction-local flag for the length of its own update.
CREATE OR REPLACE FUNCTION public.cms_guard_retained_document()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_review jsonb;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.source_system = 'web_archive' AND
    coalesce(NEW.metadata #> '{review,required}' = 'true'::jsonb, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'A web_archive source stays under review until cms_resolve_review clears it';
  END IF;

  IF TG_OP = 'UPDATE' AND
    (NEW.metadata -> 'review') IS DISTINCT FROM (OLD.metadata -> 'review') AND
    coalesce(current_setting('cms.review_resolution', true), '') IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'Review gates cannot be changed by ordinary document saves';
  END IF;

  IF NEW.metadata ? 'review' THEN
    v_review := NEW.metadata -> 'review';
    IF jsonb_typeof(v_review) IS DISTINCT FROM 'object' OR
      jsonb_typeof(v_review -> 'required') IS DISTINCT FROM 'boolean' OR
      jsonb_typeof(v_review -> 'reasons') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'Review gates require a boolean required flag and a reasons array';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_review) AS fields(key)
      WHERE key NOT IN ('required', 'reasons')) OR
      jsonb_array_length(v_review -> 'reasons') > 100 OR
      EXISTS (SELECT 1 FROM jsonb_array_elements(v_review -> 'reasons') AS reasons(value)
        WHERE jsonb_typeof(value) IS DISTINCT FROM 'string' OR
          (value #>> '{}') !~ '^[a-z][a-z0-9_]{0,119}$') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid review reason codes';
    END IF;

    IF v_review ->> 'required' = 'true' THEN
      IF jsonb_array_length(v_review -> 'reasons') = 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = 'A required review gate must explain why review is needed';
      END IF;
      IF TG_OP = 'INSERT' THEN
        NEW.publication_state := 'review';
        NEW.published_at := NULL;
      ELSIF NEW.publication_state = 'published' THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = 'A document requiring review cannot be published';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.cms_resolve_review(
  p_document_id uuid,
  p_expected_revision integer,
  p_patch jsonb,
  p_actor text,
  p_note text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_doc public.cms_documents%ROWTYPE;
  v_next public.cms_documents%ROWTYPE;
  v_previous_review jsonb;
  v_previous_state text;
  v_key text;
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) NOT BETWEEN 1 AND 320 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'An actor is required';
  END IF;
  IF p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A resolution note is required';
  END IF;
  p_patch := coalesce(p_patch, '{}'::jsonb);
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Edit must be an object';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN ('title','byline','body_html','excerpt','slug','public_url','metadata','publication_state') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Field is not editable: ' || v_key;
    END IF;
  END LOOP;
  IF p_patch ? 'metadata' AND jsonb_typeof(p_patch -> 'metadata') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'metadata must be an object';
  END IF;
  IF p_patch ? 'publication_state' AND p_patch ->> 'publication_state' NOT IN ('draft','review','published','unpublished') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid publication state';
  END IF;

  SELECT * INTO v_doc FROM public.cms_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Document not found';
  END IF;
  IF p_expected_revision IS DISTINCT FROM v_doc.revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'revision_conflict: reload the document before saving';
  END IF;
  IF coalesce(v_doc.metadata #> '{review,required}' = 'true'::jsonb, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Document has no open review gate';
  END IF;
  v_previous_review := v_doc.metadata -> 'review';
  v_previous_state := v_doc.publication_state;

  p_patch := jsonb_set(p_patch, '{metadata}',
    v_doc.metadata || coalesce(p_patch -> 'metadata', '{}'::jsonb) || jsonb_build_object('review', jsonb_build_object('required', false, 'reasons', '[]'::jsonb)));
  v_next := jsonb_populate_record(v_doc, p_patch);

  PERFORM set_config('cms.review_resolution', 'on', true);
  UPDATE public.cms_documents SET title = v_next.title, byline = v_next.byline,
    body_html = v_next.body_html, excerpt = v_next.excerpt,
    slug = nullif(v_next.slug, ''), public_url = nullif(v_next.public_url, ''),
    metadata = v_next.metadata, publication_state = v_next.publication_state,
    revision = revision + 1, updated_at = clock_timestamp()
    WHERE id = p_document_id RETURNING * INTO v_doc;
  PERFORM set_config('cms.review_resolution', 'off', true);

  INSERT INTO public.cms_document_revisions (document_id, revision, snapshot, actor, reason)
    VALUES (v_doc.id, v_doc.revision, to_jsonb(v_doc), p_actor, 'edit');
  INSERT INTO public.cms_review_resolutions (document_id, revision, previous_review, previous_state, next_state, note, actor)
    VALUES (v_doc.id, v_doc.revision, v_previous_review, v_previous_state, v_doc.publication_state, p_note, p_actor);
  RETURN to_jsonb(v_doc);
END;
$$;

REVOKE ALL ON FUNCTION public.cms_resolve_review(uuid, integer, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_resolve_review(uuid, integer, jsonb, text, text) TO service_role;
