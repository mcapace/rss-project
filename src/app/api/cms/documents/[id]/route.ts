import { requireCmsUser } from "@/lib/cms/auth-server";
import { assertSameOrigin, CmsError, readJson } from "@/lib/cms/access";
import { getCmsDocument } from "@/lib/cms/documents-server";
import { cmsDb, databaseError } from "@/lib/cms/db";
import { cmsJson, cmsFailure } from "@/lib/cms/http";
import { documentPatch } from "@/lib/cms/validation";
import { sanitizeCmsHtml } from "@/lib/cms/html";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireCmsUser();
    const { id } = await context.params;
    const document = await getCmsDocument(id, user);
    return cmsJson({ document, preview_html: sanitizeCmsHtml(document.body_html) });
  } catch (error) { return cmsFailure(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const user = await requireCmsUser();
    const { id } = await context.params;
    const current = await getCmsDocument(id, user);
    const body = await readJson(request);
    if (!Number.isInteger(body.expected_revision) || Number(body.expected_revision) < 1) throw new CmsError(422, "Save requires the version you opened.");
    if (!body.patch || typeof body.patch !== "object" || Array.isArray(body.patch)) throw new CmsError(422, "Provide the document changes.");
    const patch = documentPatch(body.patch as Record<string, unknown>, current);
    const { data, error } = await cmsDb().rpc("cms_save_document", {
      p_document_id: id, p_expected_revision: body.expected_revision, p_patch: patch, p_actor: user.id,
    });
    if (error) databaseError(error);
    return cmsJson({ document: data, preview_html: sanitizeCmsHtml(data.body_html || "") });
  } catch (error) { return cmsFailure(error); }
}
