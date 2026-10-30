-- Retain every captured source identity, including specialized and incomplete
-- content. No existing editorial record or source/history row is rewritten.
ALTER TABLE public.cms_documents
  DROP CONSTRAINT cms_documents_kind_check,
  ADD CONSTRAINT cms_documents_kind_check CHECK (kind IN (
    'article', 'rating', 'page', 'glossary_entry', 'directory_entry',
    'collection_entry', 'product_review', 'legacy_record'
  )),
  DROP CONSTRAINT cms_documents_title_check,
  ADD CONSTRAINT cms_documents_title_check CHECK (
    length(btrim(title)) <= 1000 AND (
      length(btrim(title)) >= 1 OR
      coalesce(metadata #> '{review,required}' = 'true'::jsonb, false)
    )
  );

-- A review gate is migration/editorial workflow data, not a publish toggle.
-- Ordinary saves may retain it but cannot clear or replace it. Resolution
-- requires a future dedicated workflow with its own audit contract.
CREATE FUNCTION public.cms_guard_retained_document()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_review jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND
    (NEW.metadata -> 'review') IS DISTINCT FROM (OLD.metadata -> 'review') THEN
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
        -- The immutable source payload retains the original source status/date.
        -- New incomplete records are editorial review items, regardless of a
        -- legacy publication flag supplied by the caller.
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

CREATE TRIGGER cms_documents_retained_review_guard
  BEFORE INSERT OR UPDATE ON public.cms_documents
  FOR EACH ROW EXECUTE FUNCTION public.cms_guard_retained_document();

REVOKE ALL ON FUNCTION public.cms_guard_retained_document() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_guard_retained_document() TO service_role;
