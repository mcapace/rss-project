import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireCmsUser } from "@/lib/cms/auth-server";
import { assertBrand, CmsError } from "@/lib/cms/access";
import { cmsDb, databaseError } from "@/lib/cms/db";
import { cmsFailure, cmsJson } from "@/lib/cms/http";
import { CMS_DOCUMENT_KINDS, CMS_PUBLICATION_STATES, type CmsBrand } from "@/lib/cms/types";
import { getS3Client } from "@/lib/s3";
import { reciprocalRankFusion } from "@/lib/editorial/rank";
import type { SearchDocumentHit, SearchMediaHit, SearchResponse } from "@/lib/editorial/search-types";
import { embeddingsConfigured, semanticMatches } from "@/lib/editorial/server/embeddings";

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

    // Semantic matches (pgvector) blend with the lexical results by reciprocal rank fusion when a provider is configured.
    let documentHits = (documents.data ?? []) as SearchDocumentHit[];
    let mediaHits = ((media.data ?? []) as Omit<SearchMediaHit, "preview_url">[]);
    let semantic = false;
    if (embeddingsConfigured() && q.length >= 3 && (wants("documents") || wants("media"))) {
      try {
        const matches = await semanticMatches(db, brands, q, scope === "media" ? "media" : scope === "documents" ? "document" : null, Math.min(60, limit * 2), request.signal);
        semantic = true;
        const docMatches = matches.filter(match => match.kind === "document" && (!kind || true));
        const missingDocs = docMatches.map(match => match.document_id).filter(id => !documentHits.some(hit => hit.id === id));
        if (wants("documents") && missingDocs.length) {
          const { data: rows } = await db.from("cms_documents").select("id,brand,kind,source_system,title,byline,excerpt,publication_state,issue_uuid,published_at,updated_at").in("id", missingDocs.slice(0, 40));
          const extra = ((rows ?? []) as Omit<SearchDocumentHit, "rank" | "headline">[]).filter(row => (!kind || row.kind === kind) && (!state || row.publication_state === state)).map(row => ({ ...row, rank: docMatches.find(match => match.document_id === row.id)?.similarity ?? 0, headline: (row.excerpt || "").slice(0, 180) }));
          const semanticOrder = docMatches.map(match => match.document_id);
          const merged = reciprocalRankFusion([{ items: documentHits }, { items: extra.concat(documentHits.filter(hit => semanticOrder.includes(hit.id))).sort((a, b) => semanticOrder.indexOf(a.id) - semanticOrder.indexOf(b.id)) }], hit => hit.id);
          documentHits = merged.map(entry => entry.item).slice(0, limit);
        }
        const mediaMatches = matches.filter(match => match.kind === "media" && match.media_index !== null);
        if (wants("media") && mediaMatches.length) {
          const missing = mediaMatches.filter(match => !mediaHits.some(hit => hit.document_id === match.document_id && hit.media_index === match.media_index));
          const ids = [...new Set(missing.map(match => match.document_id))].slice(0, 30);
          const { data: rows } = ids.length ? await db.from("cms_documents").select("id,brand,issue_uuid,title,metadata").in("id", ids) : { data: [] };
          const extra: Omit<SearchMediaHit, "preview_url">[] = [];
          for (const match of missing) {
            const row = (rows ?? []).find((entry: { id: string }) => entry.id === match.document_id) as { id: string; brand: CmsBrand; issue_uuid: string | null; title: string; metadata: { media?: unknown } } | undefined;
            const item = Array.isArray(row?.metadata?.media) ? row.metadata.media[match.media_index as number] : null;
            if (!row || !item || typeof item !== "object") continue;
            const entry = item as Record<string, unknown>;
            extra.push({ document_id: row.id, brand: row.brand, issue_uuid: row.issue_uuid, document_title: row.title, media_index: match.media_index as number,
              file: typeof entry.file === "string" ? entry.file : null, s3_key: typeof entry.s3_key === "string" ? entry.s3_key : null, caption: typeof entry.caption === "string" ? entry.caption : null,
              credit: typeof entry.credit === "string" ? entry.credit : null, alt: typeof entry.alt === "string" ? entry.alt : null, is_lead: entry.is_lead === true,
              vision: (entry.vision as SearchMediaHit["vision"]) ?? null, palette: (entry.palette as SearchMediaHit["palette"]) ?? null, crops: (entry.crops as SearchMediaHit["crops"]) ?? null, rank: match.similarity });
          }
          const key = (hit: Omit<SearchMediaHit, "preview_url">) => `${hit.document_id}:${hit.media_index}`;
          const semanticOrder = mediaMatches.map(match => `${match.document_id}:${match.media_index}`);
          const merged = reciprocalRankFusion([{ items: mediaHits }, { items: extra.concat(mediaHits.filter(hit => semanticOrder.includes(key(hit)))).sort((a, b) => semanticOrder.indexOf(key(a)) - semanticOrder.indexOf(key(b))) }], key);
          mediaHits = merged.map(entry => entry.item).slice(0, Math.min(60, limit * 2));
        }
      } catch { semantic = false; }
    }
    const bucket = process.env.S3_BUCKET;
    const client = bucket && mediaHits.length ? getS3Client() : null;
    const signed: SearchMediaHit[] = await Promise.all(mediaHits.map(async hit => {
      const key = hit.s3_key;
      const allowed = client && typeof key === "string" && hit.issue_uuid && key.startsWith(`cms/print/${hit.brand}/${hit.issue_uuid}/`) && !key.split("/").some(part => part === "..");
      const preview_url = allowed ? await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 300 }).catch(() => null) : null;
      return { ...hit, preview_url };
    }));

    return cmsJson({ query: q, documents: documentHits, media: signed, keywords: keywords.data ?? [], semantic } satisfies SearchResponse);
  } catch (error) { return cmsFailure(error); }
}
