-- Supabase's default table ACLs grant service_role ALL privileges. Narrow GRANTs
-- do not remove those defaults, so revoke them before restoring the CMS contract.
-- In particular, immutable history must not be truncatable by the application.
REVOKE ALL ON public.cms_documents, public.cms_source_snapshots,
  public.cms_document_revisions FROM service_role;

GRANT SELECT, INSERT, UPDATE ON public.cms_documents TO service_role;
GRANT SELECT, INSERT ON public.cms_source_snapshots,
  public.cms_document_revisions TO service_role;
