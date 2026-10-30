import { CmsWorkspace } from "@/components/cms/CmsWorkspace";
import { CmsAccessScreen } from "@/components/cms/CmsAccessScreen";
import { authorizeCmsPage } from "@/lib/cms/page-access";
import { resolveCmsBrand } from "@/lib/cms/publications";

export const dynamic = "force-dynamic";
export default async function CmsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const brand = typeof params.brand === "string" ? params.brand : undefined;
  const issue = typeof params.issue === "string" ? params.issue : undefined;
  const query = new URLSearchParams();
  if (brand) query.set("brand", brand);
  if (issue) query.set("issue", issue);
  const access = await authorizeCmsPage(`/cms${query.size ? `?${query}` : ""}`);
  if (!access.ok) return <CmsAccessScreen reason={access.reason} />;
  const selectedBrand = resolveCmsBrand(brand, access.user.brands);
  return <CmsWorkspace key={`${selectedBrand}:${issue || ""}`} user={access.user} initialBrand={selectedBrand} initialIssue={issue} />;
}
