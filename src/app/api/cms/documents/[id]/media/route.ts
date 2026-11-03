import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireCmsUser } from "@/lib/cms/auth-server";
import { getCmsDocument } from "@/lib/cms/documents-server";
import { CmsError } from "@/lib/cms/access";
import { cmsJson, cmsFailure } from "@/lib/cms/http";
import { getS3Client } from "@/lib/s3";
import { allowedMediaKey, mediaRenditionUrl } from "@/lib/media/keys";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireCmsUser();
    const { id } = await params;
    const document = await getCmsDocument(id, user);
    const candidates = Array.isArray(document.metadata.media) ? document.metadata.media.slice(0, 100) : [];
    if (!candidates.length) return cmsJson({ media: [] });
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new CmsError(503, "Image storage has not been connected yet.", "setup_required");
    const client = getS3Client();
    const media = await Promise.all(candidates.map(async (item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const key = item.s3_key;
      if (!allowedMediaKey(key, document.brand, document.issue_uuid ?? null)) return null;
      // Print assets are signed as before. Images re-hosted from the old site and editor uploads preview through the
      // rendition route (same origin, so the crop tool and the palette reader can read the pixels).
      if (!key.startsWith("cms/print/")) return { ...item, index, preview_url: mediaRenditionUrl(document.id, index, 1600) };
      const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 300 });
      return { ...item, index, preview_url: url };
    }));
    return cmsJson({ media: media.filter(Boolean) });
  } catch (error) { return cmsFailure(error); }
}
