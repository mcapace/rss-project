import { MediaLibrary } from "@/components/editorial/MediaLibrary";

export default async function CmsMediaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const gallery = typeof params.gallery === "string" && params.gallery ? params.gallery : null;
  const q = typeof params.q === "string" ? params.q : "";
  return <MediaLibrary key={`${gallery ?? ""}:${q}`} initialGallery={gallery} initialQuery={q} />;
}
