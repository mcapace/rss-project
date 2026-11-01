import { GetObjectCommand } from "@aws-sdk/client-s3";
import { CmsError } from "@/lib/cms/access";
import { requireCmsUser } from "@/lib/cms/auth-server";
import { cmsFailure } from "@/lib/cms/http";
import { assertLibraryKey } from "@/lib/cms/media-library-server";
import { webFileName } from "@/lib/editorial/media-library-types";
import { brandValue } from "@/lib/cms/validation";
import { renderRendition } from "@/lib/media/renditions";
import { getS3Client } from "@/lib/s3";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * A stored library file for signed-in editors: `?w=` returns a WebP preview of an image
 * (TIFFs included); without it the original streams as stored, under its web name when it has one
 * (`?download=1` saves it instead of opening it).
 */
export async function GET(request: Request) {
  try {
    const user = await requireCmsUser();
    const params = new URL(request.url).searchParams;
    const brand = brandValue(params.get("brand"));
    const key = params.get("key") ?? "";
    const file = await assertLibraryKey(brand, user, key);
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new CmsError(503, "Image storage has not been connected yet.", "setup_required");
    const width = params.get("w") ? Number(params.get("w")) : null;
    if (width !== null && (!Number.isFinite(width) || width < 16 || width > 2400)) throw new CmsError(422, "Width must be between 16 and 2400.", "validation_failed");
    const object = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await object.Body?.transformToByteArray();
    if (!bytes) throw new CmsError(404, "File not found.");
    if (width && /^image\//.test(file.mime)) {
      const rendition = await renderRendition(bytes, { width, format: "webp" });
      return new Response(new Uint8Array(rendition.body), { headers: { "Content-Type": rendition.contentType, "Cache-Control": "private, max-age=86400" } });
    }
    const name = webFileName(file).replace(/["\\\r\n]/g, "_");
    const disposition = params.get("download") === "1" ? "attachment" : "inline";
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": file.mime || object.ContentType || "application/octet-stream", "Content-Disposition": `${disposition}; filename="${name}"`, "Cache-Control": "private, max-age=86400" } });
  } catch (error) { return cmsFailure(error); }
}
