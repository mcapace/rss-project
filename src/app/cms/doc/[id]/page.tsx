import { DocumentWorkspace } from "@/components/editorial/DocumentWorkspace";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DocumentWorkspace key={id} id={id} />;
}
