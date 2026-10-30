import { redirect } from "next/navigation";
import { isCmsBrand } from "@/lib/cms/publications";

/** The issue inbox is the Print intake page of the workspace. */
export default async function AdminIssuesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const brand = typeof params.brand === "string" && isCmsBrand(params.brand) ? params.brand : null;
  redirect(brand ? `/cms/print?brand=${brand}` : "/cms/print");
}
