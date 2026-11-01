import "server-only";
import { assertBrand, CmsError, type CmsUser } from "./access";
import { cmsDb, databaseError } from "./db";
import type { CmsBrand } from "./types";
import type { MediaFile, MediaFilePage, MediaGallery, MediaLibraryOverview } from "@/lib/editorial/media-library-types";

/** Types the public asset route can serve and resize; anything else streams through the CMS file route. */
const PUBLIC_EXT = /\.(jpg|png|gif|webp|avif|pdf|mp4|mov|m4v|webm)$/;
const KEY = /^cms\/legacy\/(wa|ws|ca|mw)\/([a-f0-9]{64})\.([a-z0-9]{2,5})$/;

export function publicUrl(key: string | null): string | null {
  const match = key ? KEY.exec(key) : null;
  return match && PUBLIC_EXT.test(key!) ? `/api/wa/asset/${match[2]}.${match[3]}` : null;
}

export function fileUrl(brand: CmsBrand, key: string | null, width?: number): string | null {
  if (!key || !KEY.test(key)) return null;
  const params = new URLSearchParams({ brand, key });
  if (width) params.set("w", String(width));
  return `/api/cms/media/library/file?${params}`;
}

export async function mediaLibraryOverview(brand: CmsBrand, user: CmsUser): Promise<MediaLibraryOverview> {
  assertBrand(user, brand);
  const { data, error } = await cmsDb().rpc("cms_media_gallery_summary", { p_brand: brand });
  if (error) databaseError(error);
  const rows = (data ?? []) as { source_gallery_id: string; name: string; title: string; description: string; created_at: string | null; files: number; stored: number; pending: number; failed: number; bytes: number; cover_key: string | null }[];
  const galleries: MediaGallery[] = rows.map(row => ({
    id: row.source_gallery_id, name: row.name, title: row.title || row.name || `Gallery ${row.source_gallery_id}`, description: row.description, created_at: row.created_at,
    files: Number(row.files), stored: Number(row.stored), pending: Number(row.pending), failed: Number(row.failed), bytes: Number(row.bytes),
    cover: fileUrl(brand, row.cover_key, 480),
  })).sort((a, b) => b.files - a.files || a.title.localeCompare(b.title));
  const totals = galleries.reduce((sum, g) => ({ galleries: sum.galleries + 1, files: sum.files + g.files, stored: sum.stored + g.stored, pending: sum.pending + g.pending, failed: sum.failed + g.failed, bytes: sum.bytes + g.bytes }), { galleries: 0, files: 0, stored: 0, pending: 0, failed: 0, bytes: 0 });
  return { galleries, totals };
}

type FileRow = { source_gallery_id: string; source_file_id: string; file_name: string; title: string; alt: string; mime: string; width: number | null; height: number | null; bytes: number | null; stored_bytes: number | null; uploaded_at: string | null; source_url: string; status: "pending" | "stored" | "failed"; sha256: string | null; s3_key: string | null; error: string | null };

export async function mediaLibraryFiles(brand: CmsBrand, user: CmsUser, options: { gallery?: string | null; q?: string | null; status?: string | null; offset?: number; limit?: number }): Promise<MediaFilePage> {
  assertBrand(user, brand);
  const limit = Math.min(120, Math.max(1, options.limit ?? 60));
  const offset = Math.max(0, options.offset ?? 0);
  let query = cmsDb().from("cms_media_files")
    .select("source_gallery_id,source_file_id,file_name,title,alt,mime,width,height,bytes,stored_bytes,uploaded_at,source_url,status,sha256,s3_key,error", { count: "exact" })
    .eq("brand", brand);
  if (options.gallery) query = query.eq("source_gallery_id", options.gallery);
  if (options.status && ["stored", "pending", "failed"].includes(options.status)) query = query.eq("status", options.status);
  const q = (options.q ?? "").trim();
  if (q) {
    if (q.length > 120) throw new CmsError(422, "Search for a shorter file name.", "validation_failed");
    // Each pattern is quoted, so names with commas, dots or brackets cannot break the filter.
    const like = `"%${q.replace(/[%_\\]/g, m => `\\${m}`).replace(/"/g, '\\"')}%"`;
    query = query.or(`file_name.ilike.${like},title.ilike.${like},alt.ilike.${like}`);
  }
  query = options.gallery && !q ? query.order("sort_order", { ascending: true, nullsFirst: false }).order("file_name") : query.order("uploaded_at", { ascending: false, nullsFirst: false }).order("file_name");
  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) databaseError(error);
  const rows = (data ?? []) as FileRow[];

  // The stories that use these files, by content hash or (not copied yet) by the Morweb file name.
  const shas = [...new Set(rows.map(r => r.sha256).filter((s): s is string => !!s))];
  const names = [...new Set(rows.map(r => r.file_name.toLowerCase()))];
  const usage = new Map<string, { id: string; title: string; state: string }[]>();
  if (rows.length) {
    const { data: used, error: usageError } = await cmsDb().rpc("cms_media_file_usage", { p_brand: brand, p_sha256: shas, p_names: names });
    if (usageError) databaseError(usageError);
    for (const hit of (used ?? []) as { sha256: string | null; file_name: string; document_id: string; title: string; publication_state: string }[]) {
      for (const key of [hit.sha256, `name:${hit.file_name}`]) {
        if (!key) continue;
        const list = usage.get(key) ?? [];
        if (!list.some(doc => doc.id === hit.document_id)) list.push({ id: hit.document_id, title: hit.title, state: hit.publication_state });
        usage.set(key, list);
      }
    }
  }
  const galleryNames = new Map<string, string>();
  if (!options.gallery && rows.length) {
    const ids = [...new Set(rows.map(r => r.source_gallery_id))];
    const { data: gs, error: gError } = await cmsDb().from("cms_media_galleries").select("source_gallery_id,title,name").eq("brand", brand).in("source_gallery_id", ids);
    if (gError) databaseError(gError);
    for (const g of (gs ?? []) as { source_gallery_id: string; title: string; name: string }[]) galleryNames.set(g.source_gallery_id, g.title || g.name);
  }

  const files: MediaFile[] = rows.map(row => {
    const docs = new Map<string, { id: string; title: string; state: string }>();
    for (const doc of [...(row.sha256 ? usage.get(row.sha256) ?? [] : []), ...(usage.get(`name:${row.file_name.toLowerCase()}`) ?? [])]) docs.set(doc.id, doc);
    const image = /^image\//.test(row.mime);
    return {
      gallery_id: row.source_gallery_id, gallery: galleryNames.get(row.source_gallery_id) ?? null, id: row.source_file_id,
      file_name: row.file_name, title: row.title, alt: row.alt, mime: row.mime, width: row.width, height: row.height,
      bytes: row.stored_bytes ?? row.bytes, uploaded_at: row.uploaded_at, source_url: row.source_url, status: row.status, error: row.error, sha256: row.sha256,
      thumb: row.status === "stored" && image ? fileUrl(brand, row.s3_key, 360) : null,
      original: row.status === "stored" ? fileUrl(brand, row.s3_key) : null,
      public_url: row.status === "stored" ? publicUrl(row.s3_key) : null,
      used_in: [...docs.values()].slice(0, 12),
    };
  });
  return { files, total: count ?? files.length, offset, limit };
}

/** Confirms the key belongs to a stored library file of this publication before it is streamed. */
export async function assertLibraryKey(brand: CmsBrand, user: CmsUser, key: string): Promise<{ mime: string; file_name: string }> {
  assertBrand(user, brand);
  const match = KEY.exec(key);
  if (!match || match[1] !== brand) throw new CmsError(404, "File not found.");
  const { data, error } = await cmsDb().from("cms_media_files").select("mime,file_name").eq("brand", brand).eq("s3_key", key).eq("status", "stored").limit(1);
  if (error) databaseError(error);
  const row = (data ?? [])[0] as { mime: string; file_name: string } | undefined;
  if (!row) throw new CmsError(404, "File not found.");
  return row;
}
