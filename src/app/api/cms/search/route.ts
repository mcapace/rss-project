import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireCmsUser } from "@/lib/cms/auth-server";
import { assertBrand, CmsError } from "@/lib/cms/access";
import { cmsDb, databaseError } from "@/lib/cms/db";
import { cmsFailure, cmsJson } from "@/lib/cms/http";
import { CMS_DOCUMENT_KINDS, CMS_PUBLICATION_STATES, type CmsBrand } from "@/lib/cms/types";
import { getS3Client } from "@/lib/s3";
import type { SearchMediaHit, SearchResponse } from "@/lib/editorial/search-types";

const SCOPES = new Set(["all", "documents", "media", "keywords"]);

/** Unified search over documents, attached images and keywords for the publications a user may see. */
export async function GET(request: Request) {
  try {
    const user = await requireCmsUser();
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
    const scope = url.searchParams.get("scope") ?? "all";
    if (!SCOPES.has(scope)) throw new CmsError(422, "Unknown search scope.", "validation_failed");
    const brandParam = url.searchParams.get("brand");
    const brands: CmsBrand[] = brandParam ? (assertBrand(user, brandParam), [brandParam]) : user.brands;
    const kind = url.searchParams.get("kind");
    if (kind && !(CMS_DOCUMENT_KINDS as readonly string[]).includes(kind)) throw new CmsError(422, "Unknown content type.", "validation_failed");
    const state = url.searchParams.get("state");
    if (state && !(CMS_PUBLICATION_STATES as readonly string[]).includes(state)) throw new CmsError(422, "Unknown publication state.", "validation_failed");
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));
    if (!q && scope !== "keywords") return cmsJson({ query: q, documents: [], media: [], keywords: [] } satisfies SearchResponse);

    const db = cmsDb();
    const wants = (name: string) => scope === "all" || scope === name;
    const [documents, media, keywords] = await Promise.all([
      wants("documents") ? db.rpc("cms_search_documents", { p_brands: brands, p_query: q, p_kind: kind, p_state: state, p_limit: limit }) : Promise.resolve({ data: [], error: null }),
      wants("media") ? db.rpc("cms_search_media", { p_brands: brands, p_query: q, p_limit: Math.min(60, limit * 2) }) : Promise.resolve({ data: [], error: null }),
      wants("keywords") ? db.rpc("cms_search_keywords", { p_brands: brands, p_query: q, p_limit: 30 }) : Promise.resolve({ data: [], error: null }),
    ]);
    for (const result of [documents, media, keywords]) {
      if (result.error) {
        if (result.error.code === "PGRST202" || result.error.code === "42883") throw new CmsError(503, "Search is not set up yet: apply the cms_search migration to the content database.", "setup_required");
        databaseError(result.error);
      }
    }

    const mediaHits = ((media.data ?? []) as Omit<SearchMediaHit, "preview_url">[]);
    const bucket = process.env.S3_BUCKET;
    const client = bucket && mediaHits.length ? getS3Client() : null;
    const signed: SearchMediaHit[] = await Promise.all(mediaHits.map(async hit => {
      const key = hit.s3_key;
      const allowed = client && typeof key === "string" && hit.issue_uuid && key.startsWith(`cms/print/${hit.brand}/${hit.issue_uuid}/`) && !key.split("/").some(part => part === "..");
      const preview_url = allowed ? await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 300 }).catch(() => null) : null;
      return { ...hit, preview_url };
    }));

    return cmsJson({ query: q, documents: documents.data ?? [], media: signed, keywords: keywords.data ?? [] } satisfies SearchResponse);
  } catch (error) { return cmsFailure(error); }
}
