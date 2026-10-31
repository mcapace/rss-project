-- The home page's news rotator: five positions. A position with a row here is
-- pinned to that document (a sponsored story, an older feature); a position
-- without one shows the newest story in order. Editors manage it at /cms/front.
CREATE TABLE IF NOT EXISTS public.cms_front_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL CHECK (brand IN ('wa', 'ws', 'ca', 'mw')),
  position integer NOT NULL CHECK (position BETWEEN 1 AND 5),
  document_id uuid NOT NULL REFERENCES public.cms_documents(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT '' CHECK (label IN ('', 'sponsored', 'archive', 'editors')),
  ends_at timestamptz,
  set_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand, position)
);
CREATE INDEX IF NOT EXISTS cms_front_slots_document_idx ON public.cms_front_slots (document_id);

ALTER TABLE public.cms_front_slots ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cms_front_slots TO service_role;
GRANT SELECT ON public.cms_front_slots TO authenticated;
DROP POLICY IF EXISTS cms_front_slots_brand_select ON public.cms_front_slots;
CREATE POLICY cms_front_slots_brand_select ON public.cms_front_slots FOR SELECT TO authenticated USING (brand = ANY (public.cms_jwt_brands()));
