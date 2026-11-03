import { after } from "next/server";
import { requireCmsUser } from "@/lib/cms/auth-server";
import { assertSameOrigin, CmsError, readJson } from "@/lib/cms/access";
import { cmsDb, databaseError } from "@/lib/cms/db";
import { getCmsDocument } from "@/lib/cms/documents-server";
import { sanitizeCmsHtml } from "@/lib/cms/html";
import { cmsFailure, cmsJson } from "@/lib/cms/http";
import type { CmsDocument } from "@/lib/cms/types";
import { embeddingsConfigured, refreshDocumentEmbeddings } from "@/lib/editorial/server/embeddings";

type Context = { params: Promise<{ id: string }> };

/** The database's own publishing messages ("Before publishing, add a headline") are written for editors; pass them on. */
function publishError(error: { code?: string; message?: string }): never {
  if (error.code === "22023" && error.message && error.message.length < 300) throw new CmsError(422, error.message, "validation_failed");
  databaseError(error);
}

/**
 * Publish a story to the website, now or at a scheduled time (cms_publish_document): the slug is filled from the
 * headline when empty and kept unique, published_at is stamped, and a 'publish' revision is recorded.
 * Body: { expected_revision, publish_at? (ISO time; in the future = scheduled) }.
 */
export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const user = await requireCmsUser();
    const { id } = await context.params;
    await getCmsDocument(id, user);
    const body = await readJson(request);
    if (!Number.isInteger(body.expected_revision) || Number(body.expected_revision) < 1) throw new CmsError(422, "Publishing requires the version you opened.");
    let publishAt: string | null = null;
    if (body.publish_at !== undefined && body.publish_at !== null) {
      const when = new Date(String(body.publish_at));
      if (Number.isNaN(when.getTime())) throw new CmsError(422, "The publish time is not a valid date.");
      if (when.getTime() > Date.now() + 366 * 864e5) throw new CmsError(422, "A story can be scheduled at most a year ahead.");
      publishAt = when.toISOString();
    }
    const { data, error } = await cmsDb().rpc("cms_publish_document", { p_document_id: id, p_expected_revision: body.expected_revision, p_publish_at: publishAt, p_actor: user.id });
    if (error) publishError(error);
    const saved = data as CmsDocument;
    if (embeddingsConfigured()) after(() => refreshDocumentEmbeddings(cmsDb(), saved).catch(failure => console.error(`Embedding refresh failed for ${saved.id}:`, failure instanceof Error ? failure.message : failure)));
    return cmsJson({ document: saved, preview_html: sanitizeCmsHtml(saved.body_html || "") });
  } catch (error) { return cmsFailure(error); }
}

/** Take a published story off the website (cms_unpublish_document). Body: { expected_revision }. */
export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const user = await requireCmsUser();
    const { id } = await context.params;
    await getCmsDocument(id, user);
    const body = await readJson(request);
    if (!Number.isInteger(body.expected_revision) || Number(body.expected_revision) < 1) throw new CmsError(422, "Unpublishing requires the version you opened.");
    const { data, error } = await cmsDb().rpc("cms_unpublish_document", { p_document_id: id, p_expected_revision: body.expected_revision, p_actor: user.id });
    if (error) publishError(error);
    const saved = data as CmsDocument;
    return cmsJson({ document: saved, preview_html: sanitizeCmsHtml(saved.body_html || "") });
  } catch (error) { return cmsFailure(error); }
}
