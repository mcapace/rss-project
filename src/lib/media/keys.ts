/**
 * Where a document's attached image may live in the bucket: a content-addressed print asset for the document's own
 * issue, an image re-hosted from the old site, or an editor upload, always under the document's brand.
 */
export function allowedMediaKey(key: unknown, brand: string, issue: string | null): key is string {
  if (typeof key !== "string" || key.split("/").some(part => part === "." || part === "..")) return false;
  return (issue !== null && key.startsWith(`cms/print/${brand}/${issue}/`)) || key.startsWith(`cms/legacy/${brand}/`) || key.startsWith(`cms/uploads/${brand}/`);
}

/**
 * The platform URL for a rendition of a document's image (src/app/api/media/[id]/[index]/route.ts). It serves every
 * allowed key, resizes on the fly and keeps the editor's crop; unpublished documents need the editor's session, which
 * the CMS pages send with the request.
 */
export function mediaRenditionUrl(documentId: string, index: number, width: number): string {
  return `/api/media/${encodeURIComponent(documentId)}/${index}?w=${width}`;
}
