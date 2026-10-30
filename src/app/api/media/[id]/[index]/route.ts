import { GetObjectCommand } from "@aws-sdk/client-s3";
import { requireCmsUser } from "@/lib/cms/auth-server";
import { assertBrand, CmsError } from "@/lib/cms/access";
import { cmsDb, databaseError } from "@/lib/cms/db";
import { cmsFailure } from "@/lib/cms/http";
import { deliveryEnabled } from "@/lib/cms/runtime-config";
import { isUuid } from "@/lib/cms/validation";
import type { CmsJsonObject } from "@/lib/cms/types";
import { getS3Client } from "@/lib/s3";
import { cropOf, focalOf, parseAspect, renderRendition, type RenditionFormat } from "@/lib/media/renditions";

export const runtime = "nodejs";

const FORMATS = new Set<RenditionFormat>(["webp", "avif", "jpeg", "png"]);

/** A media item may be a content-addressed print asset or a re-hosted legacy image. */
function allowedKey(key: unknown, brand: string, issue: string | null): key is string {
  if (typeof key !== "string" || key.split("/").some(part => part === "." || part === "..")) return false;
  return (issue !== null && key.startsWith(`cms/print/${brand}/${issue}/`)) || key.startsWith(`cms/legacy/${brand}/`) || key.startsWith(`cms/uploads/${brand}/`);
}

/**
 * Stable image URL for a document's attached media, with on-the-fly renditions:
 * `?w=` width, `?format=` webp|avif|jpeg|png, `?preset=16:9` applies the editor's
 * stored crop, `?aspect=4:3` cover-crops around the focal point. Published
 * documents are public and cacheable; anything else needs the editor's session.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; index: string }> }) {
  try {
    // Preview deployments must not serve the inherited database's assets without the explicit opt-in.
    if (!deliveryEnabled()) throw new CmsError(503, "Connected CMS access is disabled in this preview.", "preview_disabled");
    const { id, index: rawIndex } = await params;
    const index = Number(rawIndex);
    if (!isUuid(id) || !Number.isInteger(index) || index < 0 || index > 500) throw new CmsError(404, "Image not found.");
    const { data: document, error } = await cmsDb().from("cms_documents").select("id,brand,issue_uuid,publication_state,metadata,revision").eq("id", id).maybeSingle();
    if (error) databaseError(error);
    if (!document) throw new CmsError(404, "Image not found.");
    const published = document.publication_state === "published";
    if (!published) {
      const user = await requireCmsUser();
      assertBrand(user, document.brand);
    }
    const media = Array.isArray(document.metadata?.media) ? (document.metadata.media as CmsJsonObject[]) : [];
    const item = media[index];
    if (!item || typeof item !== "object" || !allowedKey(item.s3_key, document.brand, document.issue_uuid)) throw new CmsError(404, "Image not found.");
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new CmsError(503, "Image storage has not been connected yet.", "setup_required");

    const url = new URL(request.url);
    const format = (url.searchParams.get("format") ?? "webp") as RenditionFormat;
    if (!FORMATS.has(format) && format !== ("original" as RenditionFormat)) throw new CmsError(422, "Unknown image format.", "validation_failed");
    const width = url.searchParams.get("w") ? Number(url.searchParams.get("w")) : null;
    if (width !== null && (!Number.isFinite(width) || width < 16 || width > 2400)) throw new CmsError(422, "Width must be between 16 and 2400.", "validation_failed");

    const object = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: item.s3_key }));
    const bytes = await object.Body?.transformToByteArray();
    if (!bytes) throw new CmsError(404, "Image not found.");
    const cache = published ? "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000" : "private, max-age=3600";
    if ((format as string) === "original") {
      return new Response(Buffer.from(bytes), { headers: { "Content-Type": object.ContentType || "application/octet-stream", "Cache-Control": cache } });
    }
    const rendition = await renderRendition(bytes, { crop: cropOf(item, url.searchParams.get("preset")), focal: focalOf(item), aspect: parseAspect(url.searchParams.get("aspect")), width, format });
    return new Response(new Uint8Array(rendition.body), { headers: { "Content-Type": rendition.contentType, "Cache-Control": cache, "X-Image-Width": String(rendition.width), "X-Image-Height": String(rendition.height) } });
  } catch (error) { return cmsFailure(error); }
}
