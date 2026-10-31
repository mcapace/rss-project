-- Cache of the public site's AI bottle recommendations per story and cocktail
-- (/api/wa/recommend). Service role only; keyed by the content and candidates sent.
CREATE TABLE IF NOT EXISTS public.wa_recommendations (
  key text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('story', 'cocktail')),
  slug text NOT NULL,
  line text NOT NULL DEFAULT '',
  items jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(items) = 'array'),
  model text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_recommendations_slug_idx ON public.wa_recommendations (kind, slug, created_at DESC);
ALTER TABLE public.wa_recommendations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_recommendations TO service_role;
