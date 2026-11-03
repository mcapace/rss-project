-- Publishing keeps a migrated story's address (2026-11-03, the root URL shape).
--
-- cms_publish_document (20261103160000_cms_publishing.sql) made the slug again on every publish (lowercase, anything
-- but a-z and 0-9 became '-'), so republishing any of the ~9,800 migrated mixed-case stories (Forty-Creek-Three-Grain-
-- Twentieth-Anniversary-40, Glenmorangie-25-Year-Old_Pommard-Wine-Cask-Finish) would have changed its URL, which on
-- whiskyadvocate.com is the old site's address itself. Now an existing slug that is already one valid path segment
-- (letters, digits, '.', '_' and '-', starting with a letter or digit, at most 200 characters) is kept exactly; only an
-- empty or invalid slug is made from the slug or the headline. Uniqueness and the redirect-collision check are unchanged
-- (a kept slug that another story already has still gets "-2"). Everything else is the function as it was.
--
-- Two guards for the root URL shape (src/lib/wa/root-routing.ts), where a story's address is whiskyadvocate.com/<slug>:
-- a slug ending in a file extension (feed.xml, stories.html, robots.txt) is not kept (it is made again, feed-xml), and a
-- slug that is one of the site's or the app's own first segments (cms, login, wa, fonts, img, ...) counts as taken, so it
-- gets "-2"; either would otherwise be shadowed by a site file, a feed route or an app prefix and never reach the story.
-- A redirect row with no document whose fixed target is this story's own address (/<slug> or /wa/<slug>) is not
-- another story's address, so it no longer pushes the story to "-2".

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

  -- The address: the story's own slug exactly as it is when it is already one valid path segment (the ~9,800 migrated
  -- stories keep the old site's capitalization, which is their URL on whiskyadvocate.com); otherwise one made from the
  -- editor's slug or the headline. Unique within the brand, and never one that an old address already redirects to a
  -- different story.
  IF coalesce(v_doc.slug, '') ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' AND length(v_doc.slug) <= 200
     AND v_doc.slug !~* '\.(html?|js|mjs|json|css|xml|txt|png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|mov|pdf|woff2?|ttf|otf|map|zip)$' THEN
    v_base := v_doc.slug;
  ELSE
    v_base := left(btrim(public.cms_slugify(coalesce(nullif(btrim(v_doc.slug), ''), v_doc.title)), '-'), 120);
  END IF;
  IF v_base = '' THEN v_base := 'story-' || left(replace(v_doc.id::text, '-', ''), 8); END IF;
  v_slug := v_base;
  WHILE lower(v_slug) = ANY (ARRAY['wa', 'cms', 'admin', 'api', 'login', 'reader', 'share', 'brands-cms', 'tag', 'recipes', 'producers',
                                    'articles', 'fonts', 'house-ads', 'img', 'notes', 'gen'])
     OR EXISTS (SELECT 1 FROM public.cms_documents d WHERE d.brand = v_doc.brand AND d.id <> v_doc.id AND lower(d.slug) = lower(v_slug))
     OR EXISTS (SELECT 1 FROM public.cms_redirects r WHERE r.brand = v_doc.brand AND r.document_id IS DISTINCT FROM v_doc.id
                AND lower(rtrim(r.legacy_path, '/')) IN ('/' || lower(v_slug), '/' || v_doc.brand || '/' || lower(v_slug))
                AND NOT (r.document_id IS NULL AND r.target_path IS NOT NULL
                         AND lower(rtrim(r.target_path, '/')) IN ('/' || lower(v_slug), '/' || v_doc.brand || '/' || lower(v_slug)))) LOOP
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

REVOKE ALL ON FUNCTION public.cms_publish_document(uuid, integer, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_publish_document(uuid, integer, timestamptz, text) TO service_role;
