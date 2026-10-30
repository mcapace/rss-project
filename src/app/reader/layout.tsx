import { CmsAccessScreen } from "@/components/cms/CmsAccessScreen";
import { authorizeCmsPage } from "@/lib/cms/page-access";
export const dynamic = "force-dynamic";
export default async function ReaderLayout({ children }: { children: React.ReactNode }) {
  const access = await authorizeCmsPage("/reader");
  if (!access.ok) return <CmsAccessScreen reason={access.reason} />;
  return children;
}
