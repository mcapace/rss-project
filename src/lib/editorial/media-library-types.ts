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
};
export type MediaFilePage = { files: MediaFile[]; total: number; offset: number; limit: number };
