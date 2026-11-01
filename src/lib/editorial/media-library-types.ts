/** The Morweb gallery library as the CMS Media page shows it. */
export type MediaGallery = {
  id: string; name: string; title: string; description: string; created_at: string | null;
  files: number; stored: number; pending: number; failed: number; bytes: number; cover: string | null;
};
export type MediaLibraryOverview = { galleries: MediaGallery[]; totals: { galleries: number; files: number; stored: number; pending: number; failed: number; bytes: number } };
export type MediaFile = {
  gallery_id: string; gallery: string | null; id: string; file_name: string; title: string; alt: string; mime: string;
  width: number | null; height: number | null; bytes: number | null; uploaded_at: string | null; source_url: string;
  status: "pending" | "stored" | "failed"; error: string | null; sha256: string | null;
  /** A resized preview, the stored original, and the public address when the type can be served on the site. */
  thumb: string | null; original: string | null; public_url: string | null;
  used_in: { id: string; title: string; state: string }[];
  /** The web name scripts/wa-media-name.ts gives each file: an SEO file name (no extension), a title, alt text, a description and keywords. */
  seo_name: string | null; seo_title: string | null; seo_alt: string | null; seo_description: string | null; keywords: string[];
  /** What kind of picture it is (bottle, portrait, distillery...) and the brand or product it shows, when known. */
  kind: string | null; brand_name: string | null; product: string | null;
};
export type MediaFilePage = { files: MediaFile[]; total: number; offset: number; limit: number };

/** The file name to use on the web and for downloads: the SEO name with the original's extension, else the original name. */
export function webFileName(file: Pick<MediaFile, "seo_name" | "file_name">): string {
  if (!file.seo_name) return file.file_name;
  const ext = (/\.([a-z0-9]{2,5})$/i.exec(file.file_name)?.[1] || "").toLowerCase().replace(/^jpeg$/, "jpg");
  return ext ? `${file.seo_name}.${ext}` : file.seo_name;
}
