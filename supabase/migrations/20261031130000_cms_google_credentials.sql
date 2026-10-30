-- Google Analytics connection per publication, mirroring the audience
-- dashboard's google_credentials table. Service-role only: RLS is enabled with
-- no policies, so anon and authenticated roles can never read a token.

CREATE TABLE IF NOT EXISTS public.cms_google_credentials (
  brand text PRIMARY KEY CHECK (brand IN ('wa', 'ws', 'ca', 'mw')),
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  google_email text,
  property_id text,
  property_name text,
  connected_by text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cms_google_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cms_google_credentials FROM anon, authenticated;
