import * as Y from "yjs";
import { requireCmsUser } from "@/lib/cms/auth-server";
import { assertSameOrigin, CmsError, readJson } from "@/lib/cms/access";
import { cmsDb, databaseError } from "@/lib/cms/db";
import { getCmsDocument } from "@/lib/cms/documents-server";
import { cmsFailure, cmsJson } from "@/lib/cms/http";
import type { CollabState } from "@/lib/editorial/platform-types";

type Context = { params: Promise<{ id: string }> };

function setupGuard(error: { code?: string }) {
  if (error.code === "PGRST202" || error.code === "42P01") throw new CmsError(503, "Collaboration state is not set up yet: apply the cms_blocks_redirects_delivery migration.", "setup_required");
  databaseError(error);
}

/** The durable Yjs state a newcomer loads before catching up over Realtime. */
export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireCmsUser();
    const { id } = await context.params;
    await getCmsDocument(id, user);
    const { data, error } = await cmsDb().from("cms_collab_documents").select("state_base64,revision,updated_at").eq("document_id", id).maybeSingle();
    if (error) setupGuard(error);
    return cmsJson({ state: (data as CollabState) ?? null });
  } catch (error) { return cmsFailure(error); }
}

/**
 * Merge the incoming state into the durable copy. Yjs updates are commutative
 * and idempotent, so merging on the server means a delayed or disconnected
 * editor can only add what it knows, never roll back what others wrote.
 */
export async function PUT(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const user = await requireCmsUser();
    const { id } = await context.params;
    const document = await getCmsDocument(id, user);
    const body = await readJson(request, 12_000_000);
    const state = typeof body.state_base64 === "string" ? body.state_base64 : "";
    if (!state || !/^[A-Za-z0-9+/=]+$/.test(state)) throw new CmsError(422, "Send the Yjs state as base64.", "validation_failed");
    const db = cmsDb();
    const { data: existing, error: readError } = await db.from("cms_collab_documents").select("state_base64,revision").eq("document_id", id).maybeSingle();
    if (readError) setupGuard(readError);
    let merged: string;
    try {
      const incoming = new Uint8Array(Buffer.from(state, "base64"));
      merged = existing?.state_base64 ? Buffer.from(Y.mergeUpdates([new Uint8Array(Buffer.from(existing.state_base64, "base64")), incoming])).toString("base64") : Buffer.from(incoming).toString("base64");
    } catch { throw new CmsError(422, "The Yjs state could not be read.", "validation_failed"); }
    const { data, error } = await db.from("cms_collab_documents").upsert({ document_id: id, brand: document.brand, state_base64: merged, revision: (existing?.revision ?? 0) + 1, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "document_id" }).select("revision,updated_at").single();
    if (error) setupGuard(error);
    return cmsJson({ saved: data });
  } catch (error) { return cmsFailure(error); }
}
