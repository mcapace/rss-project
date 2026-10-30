import { SearchPage } from "@/components/editorial/SearchPage";

export default async function CmsSearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const scope = typeof params.scope === "string" ? params.scope : "all";
  return <SearchPage key={`${q}:${scope}`} initialQuery={q} initialScope={scope} />;
}
