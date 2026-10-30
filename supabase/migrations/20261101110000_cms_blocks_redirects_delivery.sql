-- Block bodies, the redirect engine, collaborative editing state and the
-- newsletter log. Additive: body_html stays the rendered truth for every
-- existing reader; body_json is the structured block layout (TipTap document
-- JSON) written by the editor and by the migration normalizer.

ALTER TABLE public.cms_documents
  ADD COLUMN IF NOT EXISTS body_json jsonb CHECK (body_json IS NULL OR jsonb_typeof(body_json) = 'object');

-- The editor may now save body_json alongside body_html.
CREATE OR REPLACE FUNCTION public.cms_save_document(
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
    IF v_key NOT IN ('title','byline','body_html','body_json','excerpt','slug','public_url','metadata','publication_state') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Field is not editable: ' || v_key;
    END IF;
    IF v_key = 'metadata' THEN
      IF jsonb_typeof(p_patch -> v_key) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'metadata must be an object';
      END IF;
    ELSIF v_key = 'body_json' THEN
      IF jsonb_typeof(p_patch -> v_key) NOT IN ('object','null') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'body_json must be an object or null';
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
    body_html = v_next.body_html, body_json = v_next.body_json, excerpt = v_next.excerpt,
    slug = nullif(v_next.slug, ''), public_url = nullif(v_next.public_url, ''),
    metadata = v_next.metadata, publication_state = v_next.publication_state,
    revision = revision + 1, updated_at = clock_timestamp()
    WHERE id = p_document_id RETURNING * INTO v_doc;
  INSERT INTO public.cms_document_revisions (document_id, revision, snapshot, actor, reason)
    VALUES (v_doc.id, v_doc.revision, to_jsonb(v_doc), p_actor, 'edit');
  RETURN to_jsonb(v_doc);
END;
$$;

-- Service-role only write of body_json for the normalization backfill, which
-- must not create an editorial revision: the text is unchanged, only its
-- structure is derived.
CREATE OR REPLACE FUNCTION public.cms_set_body_json(p_document_id uuid, p_body_json jsonb)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  UPDATE public.cms_documents SET body_json = p_body_json WHERE id = p_document_id;
$$;
REVOKE ALL ON FUNCTION public.cms_set_body_json(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_set_body_json(uuid, jsonb) TO service_role;

-- Legacy URL mapping. One row per legacy path; the target is the canonical
-- path on the new site, or a document whose canonical path is derived when
-- the redirect is resolved. status 410 marks content retired on purpose.
CREATE TABLE IF NOT EXISTS public.cms_redirects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL CHECK (brand IN ('wa','ws','ca','mw')),
  legacy_host text,
  legacy_path text NOT NULL CHECK (legacy_path ~ '^/' AND length(legacy_path) <= 2048),
  target_path text CHECK (target_path IS NULL OR (target_path ~ '^(/|https?://)' AND length(target_path) <= 2048)),
  document_id uuid REFERENCES public.cms_documents(id) ON DELETE SET NULL,
  status smallint NOT NULL DEFAULT 301 CHECK (status IN (301, 302, 307, 308, 410)),
  source text NOT NULL DEFAULT 'import' CHECK (source IN ('import','editor','manual','slug_change')),
  hit_count bigint NOT NULL DEFAULT 0,
  last_hit_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (target_path IS NOT NULL OR document_id IS NOT NULL OR status = 410)
);
CREATE UNIQUE INDEX IF NOT EXISTS cms_redirects_path_unique ON public.cms_redirects (lower(coalesce(legacy_host, '')), lower(rtrim(legacy_path, '/')));
CREATE INDEX IF NOT EXISTS cms_redirects_document_idx ON public.cms_redirects (document_id);

ALTER TABLE public.cms_redirects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cms_redirects FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cms_redirects TO service_role;
GRANT SELECT ON public.cms_redirects TO authenticated;
CREATE POLICY cms_redirects_brand_select ON public.cms_redirects FOR SELECT TO authenticated USING (brand = ANY (public.cms_jwt_brands()));

-- The canonical public path of a document: metadata.canonical_path when set,
-- else /{brand}/{slug}. Delivery and the redirect engine agree through this.
CREATE OR REPLACE FUNCTION public.cms_canonical_path(p_document public.cms_documents)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE
    WHEN coalesce(p_document.metadata ->> 'canonical_path', '') ~ '^/' THEN p_document.metadata ->> 'canonical_path'
    WHEN coalesce(p_document.slug, '') <> '' THEN '/' || p_document.brand || '/' || p_document.slug
    ELSE NULL END;
$$;

-- Resolve one request path (host optional). Trailing slashes and case are
-- ignored. Counting hits is best effort and never blocks the redirect.
CREATE OR REPLACE FUNCTION public.cms_resolve_redirect(p_path text, p_host text DEFAULT NULL)
RETURNS TABLE (target_path text, status smallint, brand text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_row public.cms_redirects%ROWTYPE; v_doc public.cms_documents%ROWTYPE; v_target text;
BEGIN
  SELECT * INTO v_row FROM public.cms_redirects r
    WHERE lower(rtrim(r.legacy_path, '/')) = lower(rtrim(coalesce(p_path, ''), '/'))
      AND (r.legacy_host IS NULL OR p_host IS NULL OR lower(r.legacy_host) = lower(p_host))
    ORDER BY (r.legacy_host IS NOT NULL) DESC LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  v_target := v_row.target_path;
  IF v_target IS NULL AND v_row.document_id IS NOT NULL THEN
    SELECT * INTO v_doc FROM public.cms_documents WHERE id = v_row.document_id;
    IF FOUND THEN v_target := public.cms_canonical_path(v_doc); END IF;
  END IF;
  IF v_target IS NULL AND v_row.status <> 410 THEN RETURN; END IF;
  UPDATE public.cms_redirects SET hit_count = hit_count + 1, last_hit_at = clock_timestamp() WHERE id = v_row.id;
  RETURN QUERY SELECT v_target, v_row.status, v_row.brand;
END;
$$;
REVOKE ALL ON FUNCTION public.cms_resolve_redirect(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_resolve_redirect(text, text) TO service_role;

-- Yjs state for collaborative editing: one row per document, replaced as
-- editors save. Updates travel over Realtime; this is the durable copy a
-- newcomer loads before catching up. Service-role only.
CREATE TABLE IF NOT EXISTS public.cms_collab_documents (
  document_id uuid PRIMARY KEY REFERENCES public.cms_documents(id) ON DELETE CASCADE,
  brand text NOT NULL CHECK (brand IN ('wa','ws','ca','mw')),
  state_base64 text NOT NULL CHECK (length(state_base64) <= 12000000),
  revision integer NOT NULL DEFAULT 1,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cms_collab_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cms_collab_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cms_collab_documents TO service_role;

-- Every newsletter dispatch from the CMS to the ESP, so a Daily Alert can be
-- traced from the story to the campaign.
CREATE TABLE IF NOT EXISTS public.cms_newsletter_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.cms_documents(id) ON DELETE CASCADE,
  brand text NOT NULL CHECK (brand IN ('wa','ws','ca','mw')),
  kind text NOT NULL CHECK (kind IN ('daily_alert','weekly','breaking','custom')),
  esp text NOT NULL DEFAULT 'braze',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','scheduled','sent','failed','simulated')),
  subject text NOT NULL CHECK (length(btrim(subject)) BETWEEN 1 AND 300),
  preheader text,
  send_at timestamptz,
  campaign_id text,
  dispatch_id text,
  error text,
  requested_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cms_newsletter_sends_document_idx ON public.cms_newsletter_sends (document_id, created_at DESC);
ALTER TABLE public.cms_newsletter_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cms_newsletter_sends FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.cms_newsletter_sends TO service_role;
GRANT SELECT ON public.cms_newsletter_sends TO authenticated;
CREATE POLICY cms_newsletter_sends_brand_select ON public.cms_newsletter_sends FOR SELECT TO authenticated USING (brand = ANY (public.cms_jwt_brands()));

-- Published documents for the delivery tier, read by the public content API
-- with the service role. Premium blocks are stripped by the API, never here.
CREATE OR REPLACE FUNCTION public.cms_public_documents(p_brand text, p_kind text DEFAULT NULL, p_section text DEFAULT NULL, p_limit integer DEFAULT 20, p_before timestamptz DEFAULT NULL)
RETURNS TABLE (id uuid, brand text, kind text, title text, byline text, excerpt text, slug text, canonical_path text, published_at timestamptz, updated_at timestamptz, metadata jsonb)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT d.id, d.brand, d.kind, d.title, d.byline, d.excerpt, d.slug, public.cms_canonical_path(d), d.published_at, d.updated_at,
         (d.metadata - 'media' - 'warnings' - 'review' - 'migration' - 'organization')
         || jsonb_build_object('media', coalesce(d.metadata -> 'media', '[]'::jsonb))
  FROM public.cms_documents d
  WHERE d.brand = p_brand AND d.publication_state = 'published'
    AND (p_kind IS NULL OR d.kind = p_kind)
    AND (p_section IS NULL OR d.metadata ->> 'section' = p_section)
    AND (p_before IS NULL OR coalesce(d.published_at, d.updated_at) < p_before)
  ORDER BY coalesce(d.published_at, d.updated_at) DESC
  LIMIT greatest(1, least(coalesce(p_limit, 20), 100));
$$;
REVOKE ALL ON FUNCTION public.cms_public_documents(text, text, text, integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_public_documents(text, text, text, integer, timestamptz) TO service_role;
