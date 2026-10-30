import { CmsWorkspace } from "@/components/cms/CmsWorkspace";
import { resolveCmsBrand } from "@/lib/cms/publications";
import { CMS_BRANDS } from "@/lib/cms/types";
export default async function CmsDemoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const brand = resolveCmsBrand(params.brand, CMS_BRANDS);
  return <CmsWorkspace key={brand} demo initialBrand={brand} />;
}
