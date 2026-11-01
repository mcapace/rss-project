import { MediaLibrary } from "@/components/editorial/MediaLibrary";

export default async function CmsMediaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const gallery = typeof params.gallery === "string" && params.gallery ? params.gallery : null;
  const q = typeof params.q === "string" ? params.q : "";
  const file = typeof params.file === "string" && params.file ? params.file : null;
  return <MediaLibrary key={`${gallery ?? ""}:${q}:${file ?? ""}`} initialGallery={gallery} initialQuery={q} initialFile={file} />;
}
