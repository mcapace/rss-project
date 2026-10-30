import { createHash, randomUUID } from "node:crypto";
import { requireCmsUser } from "@/lib/cms/auth-server";
import { assertBrand, assertSameOrigin, CmsError, readJson } from "@/lib/cms/access";
import { cmsDb, databaseError } from "@/lib/cms/db";
import { cmsJson, cmsFailure } from "@/lib/cms/http";
import { brandValue, kindValue, textValue, isUuid } from "@/lib/cms/validation";
import { CMS_DOCUMENT_KINDS, CMS_PUBLICATION_STATES } from "@/lib/cms/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireCmsUser();
    const params = new URL(request.url).searchParams;
    const page = Number(params.get("page") || 1);
    if (!Number.isInteger(page) || page < 1 || page > 100_000) throw new CmsError(422, "Invalid page number.");
    const q = (params.get("q") || "").slice(0, 200);
    const brand = params.get("brand");
    if (brand) assertBrand(user, brand);
    const kind = params.get("kind");
    const state = params.get("state");
    const issue = params.get("issue");
    if (kind && !CMS_DOCUMENT_KINDS.includes(kind as typeof CMS_DOCUMENT_KINDS[number])) throw new CmsError(422, "Invalid content type.");
    if (state && !CMS_PUBLICATION_STATES.includes(state as typeof CMS_PUBLICATION_STATES[number])) throw new CmsError(422, "Invalid content state.");
    if (issue && !isUuid(issue)) throw new CmsError(422, "Invalid issue.");
    const db = cmsDb();
    let query = db.from("cms_documents").select("id,brand,kind,source_system,title,byline,excerpt,publication_state,published_at,issue_uuid,revision,created_at,updated_at", { count: "exact" }).in("brand", brand ? [brand] : user.brands);
    if (q) query = query.ilike("title", `%${q.replace(/[\\%_]/g, "\\$&")}%`);
    if (kind) query = query.eq("kind", kind);
    if (state) query = query.eq("publication_state", state);
    if (issue) query = query.eq("issue_uuid", issue);
    const { data, error, count } = await query.order("updated_at", { ascending: false }).order("id", { ascending: true }).range((page - 1) * 50, page * 50 - 1);
    if (error) databaseError(error);
    return cmsJson({ documents: data || [], total: count || 0, page, pageSize: 50 });
  } catch (error) { return cmsFailure(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireCmsUser();
    const body = await readJson(request, 10_000);
    const brand = brandValue(body.brand);
    assertBrand(user, brand);
    const kind = kindValue(body.kind);
    const document = {
      brand, kind, source_system: "manual", source_key: randomUUID(),
      title: textValue(body.title, "Title", 500, true).trim(),
      byline: "", body_html: "<p></p>", excerpt: "", publication_state: "draft",
      metadata: {}, source_payload: {},
    };
    const sourceHash = createHash("sha256").update(JSON.stringify(document)).digest("hex");
    const { data, error } = await cmsDb().rpc("cms_ingest_document", {
      p_document: { ...document, source_hash: sourceHash }, p_actor: user.id,
    });
    if (error) databaseError(error);
    return cmsJson(data, 201);
  } catch (error) { return cmsFailure(error); }
}
