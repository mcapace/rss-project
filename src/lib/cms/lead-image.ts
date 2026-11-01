type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {});

/**
 * A document's lead picture as a site-relative path to its self-hosted copy: the media item marked as lead
 * (/api/media/<id>/<index>), else the path recorded on metadata.lead_image.url. Null when the document has no
 * re-hosted lead; legacy-host URLs are never returned.
 */
export function leadImagePath(id: string | null | undefined, metadata: unknown, width = 1600): string | null {
  const meta = obj(metadata);
  const media = Array.isArray(meta.media) ? meta.media.map(obj) : [];
  const index = media.findIndex(item => item.is_lead === true && typeof item.s3_key === "string");
  if (id && index >= 0) return `/api/media/${id}/${index}?w=${width}`;
  const recorded = obj(meta.lead_image).url;
  return typeof recorded === "string" && recorded.startsWith("/api/") ? recorded : null;
}
