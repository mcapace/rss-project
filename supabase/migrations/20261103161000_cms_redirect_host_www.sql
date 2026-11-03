-- Legacy redirects answer for whiskyadvocate.com and www.whiskyadvocate.com alike (2026-11-03).
-- The map stores legacy_host = 'whiskyadvocate.com' (the canonical host); a request that arrives on the www host must
-- match the same rows, or every old URL would 404 there after the domain moves. Hosts compare without a leading "www.".
CREATE OR REPLACE FUNCTION public.cms_resolve_redirect(p_path text, p_host text DEFAULT NULL::text)
 RETURNS TABLE(target_path text, status smallint, brand text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE v_row public.cms_redirects%ROWTYPE; v_doc public.cms_documents%ROWTYPE; v_target text;
  v_host text := nullif(regexp_replace(lower(coalesce(p_host, '')), '^www\.', ''), '');
BEGIN
  SELECT * INTO v_row FROM public.cms_redirects r
    WHERE lower(rtrim(r.legacy_path, '/')) = lower(rtrim(coalesce(p_path, ''), '/'))
      AND (r.legacy_host IS NULL OR v_host IS NULL OR regexp_replace(lower(r.legacy_host), '^www\.', '') = v_host)
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
$function$;
