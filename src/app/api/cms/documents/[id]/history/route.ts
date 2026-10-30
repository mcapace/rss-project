import { requireCmsUser } from "@/lib/cms/auth-server";
import { getCmsDocument } from "@/lib/cms/documents-server";
import { cmsDb, databaseError } from "@/lib/cms/db";
import { cmsJson, cmsFailure } from "@/lib/cms/http";
import { sanitizeCmsHtml } from "@/lib/cms/html";
import type { CmsSourceSnapshot } from "@/lib/cms/types";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireCmsUser();
    const { id } = await params;
    const document = await getCmsDocument(id, user);
    const db = cmsDb();
    const [versions, sources] = await Promise.all([
      db.from("cms_document_revisions").select("id,revision,actor,reason,created_at,snapshot").eq("document_id", id).order("revision", { ascending: false }).limit(30),
      db.from("cms_source_snapshots").select("id,source_hash,payload,actor,created_at").eq("document_id", id).order("created_at", { ascending: false }).limit(30),
    ]);
    if (versions.error) databaseError(versions.error);
    if (sources.error) databaseError(sources.error);
    return cmsJson({
      revisions: versions.data || [],
      sources: (sources.data as CmsSourceSnapshot[] || []).map(({ id: snapshotId, source_hash, payload, created_at }) => ({
        id: snapshotId, source_hash, created_at, is_candidate: source_hash !== document.source_hash,
        title: payload.title, byline: payload.byline || "", body_html: payload.body_html,
        preview_html: sanitizeCmsHtml(payload.body_html), metadata: payload.metadata || {},
      })),
    });
  } catch (error) { return cmsFailure(error); }
}
