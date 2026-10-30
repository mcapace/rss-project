-- Realtime authorization for collaborative editing. Channels are private
-- (`cms:doc:<document id>`); a user may read or send on one only when the
-- document belongs to a publication in their JWT claims. Skipped where the
-- Realtime schema does not exist (local test harnesses).
DO $outer$
BEGIN
  IF to_regclass('realtime.messages') IS NULL THEN
    RAISE NOTICE 'realtime.messages is not present here; collaboration channel policies were not created.';
    RETURN;
  END IF;
  EXECUTE $policy$
    CREATE POLICY cms_collab_channel_read ON realtime.messages FOR SELECT TO authenticated USING (
      realtime.topic() LIKE 'cms:doc:%'
      AND EXISTS (SELECT 1 FROM public.cms_documents d WHERE d.id::text = substring(realtime.topic() from 9) AND d.brand = ANY (public.cms_jwt_brands()))
    )
  $policy$;
  EXECUTE $policy$
    CREATE POLICY cms_collab_channel_write ON realtime.messages FOR INSERT TO authenticated WITH CHECK (
      realtime.topic() LIKE 'cms:doc:%'
      AND EXISTS (SELECT 1 FROM public.cms_documents d WHERE d.id::text = substring(realtime.topic() from 9) AND d.brand = ANY (public.cms_jwt_brands()))
    )
  $policy$;
END
$outer$;
