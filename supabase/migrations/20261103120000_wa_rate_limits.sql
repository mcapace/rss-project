-- Shared rate limits for the public site's search routes (/api/wa/meaning, /api/wa/answer). Per-instance memory
-- counted each serverless instance on its own, so a client spread across instances was never limited; this
-- counts in one place. Rows are per bucket and fixed time window; visitors appear only as a hash of their IP.
CREATE TABLE IF NOT EXISTS public.wa_rate_limits (
  bucket text NOT NULL CHECK (length(bucket) <= 200),
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
ALTER TABLE public.wa_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wa_rate_limits FROM PUBLIC, anon, authenticated;

-- Counts one hit in the bucket's current window and says whether it is within the limit. Old windows are swept
-- now and then (about one call in a hundred), so the table stays small without a scheduled job.
CREATE OR REPLACE FUNCTION public.wa_rate_hit(p_bucket text, p_limit integer, p_window_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_start timestamptz; v_hits integer;
BEGIN
  IF p_bucket IS NULL OR length(p_bucket) > 200 OR coalesce(p_limit, 0) < 1 OR coalesce(p_window_seconds, 0) < 1 THEN RETURN true; END IF;
  v_start := to_timestamp(floor(extract(epoch FROM clock_timestamp()) / p_window_seconds) * p_window_seconds);
  INSERT INTO public.wa_rate_limits AS r (bucket, window_start, hits) VALUES (p_bucket, v_start, 1)
    ON CONFLICT (bucket, window_start) DO UPDATE SET hits = r.hits + 1
    RETURNING r.hits INTO v_hits;
  IF random() < 0.01 THEN DELETE FROM public.wa_rate_limits WHERE window_start < clock_timestamp() - interval '1 day'; END IF;
  RETURN v_hits <= p_limit;
END $$;
REVOKE ALL ON FUNCTION public.wa_rate_hit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_rate_hit(text, integer, integer) TO service_role;
