import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireCmsUser } from "@/lib/cms/auth-server";
import { assertBrand, assertSameOrigin, CmsError, readJson } from "@/lib/cms/access";
import { getCmsDocument } from "@/lib/cms/documents-server";
import { cmsFailure, cmsJson } from "@/lib/cms/http";
import { CMS_BRANDS, CMS_DOCUMENT_KINDS } from "@/lib/cms/types";
import { getS3Client } from "@/lib/s3";
import type { AssistChatMessage, AssistDocument } from "@/lib/editorial/assist-types";
import { analyzeSeoGeo, chatAboutDocument, describeImage } from "@/lib/editorial/server/assist";

const str = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
const strList = (value: unknown, max: number) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, max) : []);

function assistDocument(value: unknown, allowedBrands: string[]): AssistDocument {
  if (!value || typeof value !== "object") throw new CmsError(422, "Send the document to analyze.", "validation_failed");
  const raw = value as Record<string, unknown>;
  const brand = str(raw.brand, 4);
  if (!(CMS_BRANDS as readonly string[]).includes(brand) || !allowedBrands.includes(brand)) throw new CmsError(403, "You do not have access to this publication.", "access_denied");
  const kind = str(raw.kind, 40);
  if (!(CMS_DOCUMENT_KINDS as readonly string[]).includes(kind)) throw new CmsError(422, "Unknown content type.", "validation_failed");
  const seo = (raw.seo && typeof raw.seo === "object" ? raw.seo : {}) as Record<string, unknown>;
  const media = Array.isArray(raw.media) ? raw.media.slice(0, 40).map((item, index) => {
    const entry = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    return { index: Number.isInteger(entry.index) ? (entry.index as number) : index, caption: str(entry.caption, 500), alt: str(entry.alt, 500), credit: str(entry.credit, 200), file: str(entry.file, 200) };
  }) : [];
  return {
    brand: brand as AssistDocument["brand"], kind: kind as AssistDocument["kind"],
    title: str(raw.title, 500), byline: str(raw.byline, 500), excerpt: str(raw.excerpt, 5000), section: str(raw.section, 200),
    tags: strList(raw.tags, 40), slug: raw.slug == null ? null : str(raw.slug, 200), public_url: raw.public_url == null ? null : str(raw.public_url, 500),
    seo: { title: str(seo.title, 200), description: str(seo.description, 500) },
    body_text: str(raw.body_text, 120_000), media,
  };
}

/** The editorial assistant: SEO/GEO review, chat about the open story, and image descriptions for search. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireCmsUser();
    const body = await readJson(request, 1_000_000);
    const mode = body.mode;
    if (mode === "seo") {
      return cmsJson({ analysis: await analyzeSeoGeo(assistDocument(body.document, user.brands)) });
    }
    if (mode === "chat") {
      const messages: AssistChatMessage[] = Array.isArray(body.messages) ? body.messages.slice(-20).map(item => {
        const entry = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
        if (entry.role !== "user" && entry.role !== "assistant") throw new CmsError(422, "Invalid chat history.", "validation_failed");
        return { role: entry.role, content: str(entry.content, 8000) };
      }) : [];
      const document = body.document ? assistDocument(body.document, user.brands) : null;
      return cmsJson(await chatAboutDocument(messages, document));
    }
    if (mode === "describe") {
      const documentId = str(body.document_id, 64);
      const index = Number(body.media_index);
      if (!Number.isInteger(index) || index < 0 || index > 200) throw new CmsError(422, "Choose an image to describe.", "validation_failed");
      const document = await getCmsDocument(documentId, user);
      assertBrand(user, document.brand);
      const media = Array.isArray(document.metadata.media) ? document.metadata.media : [];
      const item = media[index];
      const key = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>).s3_key : null;
      if (typeof key !== "string" || !key.startsWith(`cms/print/${document.brand}/${document.issue_uuid}/`) || key.split("/").some(part => part === "..")) throw new CmsError(404, "That image is not attached to this document.", "not_found");
      const bucket = process.env.S3_BUCKET;
      if (!bucket) throw new CmsError(503, "Image storage has not been connected yet.", "setup_required");
      const url = await getSignedUrl(getS3Client(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 300 });
      const caption = typeof (item as Record<string, unknown>).caption === "string" ? (item as Record<string, unknown>).caption as string : "";
      return cmsJson({ vision: await describeImage(url, { brand: document.brand, document_title: document.title, caption }) });
    }
    throw new CmsError(422, "Unknown assistant mode.", "validation_failed");
  } catch (error) { return cmsFailure(error); }
}
