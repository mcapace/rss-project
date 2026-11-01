-- The rehost job's backlog read: documents of a publication whose body still
-- points at a legacy host. The scan over body_html took longer than the API's
-- statement timeout, so it runs inside a function that lifts the timeout for its
-- own transaction. Service role only.
CREATE OR REPLACE FUNCTION public.cms_rehost_backlog(p_brand text, p_patterns text[], p_limit integer)
RETURNS TABLE (id uuid, title text, body_html text, metadata jsonb, revision integer)
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('statement_timeout', '600000', true);
  RETURN QUERY
    SELECT d.id, d.title, d.body_html, d.metadata, d.revision
    FROM public.cms_documents d
    WHERE d.brand = p_brand
      AND EXISTS (SELECT 1 FROM unnest(p_patterns) AS p WHERE d.body_html ILIKE p)
    ORDER BY d.updated_at ASC
    LIMIT GREATEST(1, LEAST(p_limit, 2000));
END;
$$;
REVOKE ALL ON FUNCTION public.cms_rehost_backlog(text, text[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cms_rehost_backlog(text, text[], integer) TO service_role;
