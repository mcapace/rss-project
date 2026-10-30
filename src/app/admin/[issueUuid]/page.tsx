import { IssueStatus } from "@/components/editorial/IssueStatus";

export default async function IssueStatusPage({ params }: { params: Promise<{ issueUuid: string }> }) {
  const { issueUuid } = await params;
  return <IssueStatus issueId={issueUuid} />;
}
