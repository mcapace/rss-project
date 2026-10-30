import { DocumentWorkspace } from "@/components/editorial/DocumentWorkspace";

export default async function DocumentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const query = await searchParams;
  return <DocumentWorkspace key={id} id={id} initialTab={typeof query.tab === "string" ? query.tab : undefined} />;
}
