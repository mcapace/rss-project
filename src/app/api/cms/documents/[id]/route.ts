import { after } from "next/server";
import { requireCmsUser } from "@/lib/cms/auth-server";
import { assertSameOrigin, CmsError, readJson } from "@/lib/cms/access";
import { syncRating } from "@/lib/cms/catalog-server";
import { getCmsDocument } from "@/lib/cms/documents-server";
import { cmsDb, databaseError } from "@/lib/cms/db";
import { cmsJson, cmsFailure } from "@/lib/cms/http";
import { canonicalPath } from "@/lib/cms/redirects";
import { createRedirect } from "@/lib/cms/redirects-server";
import type { CmsDocument } from "@/lib/cms/types";
import { documentPatch } from "@/lib/cms/validation";
import { sanitizeCmsHtml } from "@/lib/cms/html";
import { embeddingsConfigured, upsertDocumentEmbedding } from "@/lib/editorial/server/embeddings";

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
    const saved = data as CmsDocument;
    // Keep the relational rating row in step with the document's working copy.
    if ((saved.kind === "rating" || saved.kind === "product_review") && (patch.metadata?.rating !== undefined || patch.title !== undefined || patch.excerpt !== undefined)) {
      await syncRating(saved.id, saved.metadata.rating, user.id, true);
    }
    // A slug change leaves a redirect behind so the old address keeps working.
    const previousPath = canonicalPath(current), nextPath = canonicalPath(saved);
    if (patch.slug !== undefined && previousPath && nextPath && previousPath !== nextPath) {
      await createRedirect({ brand: saved.brand, legacy_host: null, legacy_path: previousPath, target_path: null, document_id: saved.id, status: 301, source: "slug_change" }).catch(() => undefined);
    }
    // Refresh the semantic index after the response, never on the editor's clock.
    if (embeddingsConfigured() && (patch.title !== undefined || patch.excerpt !== undefined || patch.body_html !== undefined)) {
      after(() => upsertDocumentEmbedding(cmsDb(), saved).catch(() => undefined));
    }
    return cmsJson({ document: saved, preview_html: sanitizeCmsHtml(saved.body_html || "") });
  } catch (error) { return cmsFailure(error); }
}
