import { MigrationInventory } from "@/components/cms/MigrationInventory";
import { CmsAccessScreen } from "@/components/cms/CmsAccessScreen";
import { authorizeCmsPage } from "@/lib/cms/page-access";
import { resolveCmsBrand } from "@/lib/cms/publications";

export const dynamic = "force-dynamic";

export default async function MigrationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const requestedBrand = typeof params.brand === "string" ? params.brand : undefined;
  const access = await authorizeCmsPage(`/cms/migration${requestedBrand ? `?brand=${encodeURIComponent(requestedBrand)}` : ""}`);
  if (!access.ok) return <CmsAccessScreen reason={access.reason} />;
  const brand = resolveCmsBrand(requestedBrand, access.user.brands);
  if (!brand) return <CmsAccessScreen reason="denied" />;
  return <MigrationInventory key={brand} brand={brand} brands={access.user.brands} />;
}
