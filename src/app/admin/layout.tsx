import { CmsAccessScreen } from "@/components/cms/CmsAccessScreen";
import { authorizeCmsPage } from "@/lib/cms/page-access";

export const dynamic = "force-dynamic";
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const access = await authorizeCmsPage("/admin");
  if (!access.ok) return <CmsAccessScreen reason={access.reason} />;
  return children;
}
