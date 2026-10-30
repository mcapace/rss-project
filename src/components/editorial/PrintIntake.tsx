"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, FileInput, Plus } from "lucide-react";
import { formatDateTime, relativeTime } from "@/lib/editorial/helpers";
import type { PrintIssue } from "@/lib/editorial/data";
import { useEditorial } from "./EditorialProvider";
import { useAsync } from "./hooks";
import { Card, Empty, LinkButton, Notice, PageHeader, Pill, SkeletonRows } from "./ui";

const STATUS_LABELS: Record<PrintIssue["status"], string> = { queued: "Queued", processing: "Processing", review: "Ready to review", published: "Published", failed: "Failed" };

function Steps({ issue }: { issue: PrintIssue }) {
  const index = issue.status === "queued" ? 0 : issue.status === "processing" ? 1 : issue.status === "failed" ? -1 : 3;
  return <div className="ed-steps">{["Queued", "Extracting and segmenting", "Candidates in review"].map((label, step) => <span key={label} className="ed-step" data-state={index === -1 ? "todo" : step < index ? "done" : step === index ? "active" : "todo"}><i />{label}</span>)}</div>;
}

export function PrintIntake() {
  const { brand, data, demo, href, mutationVersion } = useEditorial();
  const [tick, setTick] = useState(0);
  const issues = useAsync(`print:${brand}:${mutationVersion}`, signal => data.listIssues(brand, signal), { refreshToken: tick });
  const active = (issues.data ?? []).some(issue => issue.status === "queued" || issue.status === "processing");
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick(value => value + 1), 10_000);
    return () => clearInterval(timer);
  }, [active]);
  const stat = (issue: PrintIssue, key: string) => { const value = issue.stats?.[key]; return typeof value === "number" ? value : null; };

  return <>
    <PageHeader icon={FileInput} title="Print intake" lede="Production PDFs become review candidates. Each issue keeps its extraction stats and a link to its candidates in the library."
      actions={!demo ? <LinkButton href={href("/admin/new")} variant="primary" icon={Plus}>Upload an issue</LinkButton> : undefined}>
      {active && <div style={{ paddingBottom: 12 }}><Notice>An issue is processing. This page refreshes every ten seconds while the worker runs.</Notice></div>}
    </PageHeader>
    {issues.error && <div style={{ marginBottom: 16 }}><Notice tone="error">{issues.error}</Notice></div>}
    {issues.loading && !issues.data ? <Card><SkeletonRows rows={5} /></Card> : !issues.data?.length ? <Card><Empty icon={FileInput} title="No issues yet" text={demo ? "The demo has no print issues for this publication." : "Upload a production PDF to start. The worker extracts text and images, segments articles, and sends candidates to review."} action={!demo ? <LinkButton href={href("/admin/new")} variant="primary" icon={Plus}>Upload an issue</LinkButton> : undefined} /></Card> : <Card pad={false} className="still">
      <div className="ed-table-wrap">
        <table className="ed-table">
          <thead><tr><th>Issue</th><th>Status</th><th>Progress</th><th className="num">Candidates</th><th className="num">Images kept</th><th className="num">Uploaded</th><th /></tr></thead>
          <tbody>
            {issues.data.map(issue => <tr key={issue.id}>
              <td><div className="title-cell"><Link href={issue.status === "review" ? href("/cms/library", { issue: issue.id }) : demo ? href("/cms/print") : href(`/admin/${issue.id}`)}>{issue.issue_label}</Link><small>{issue.issue_id} · {issue.pdf_key.split("/").pop()}</small></div></td>
              <td><Pill tone={issue.status}>{STATUS_LABELS[issue.status]}</Pill></td>
              <td>{issue.status === "failed" ? <span style={{ color: "var(--negative)", fontSize: 12.5 }}>{issue.error || "The worker failed."}</span> : <Steps issue={issue} />}</td>
              <td className="num">{issue.articleCount ?? "—"}</td>
              <td className="num muted">{stat(issue, "kept") ?? "—"}</td>
              <td className="num muted" title={formatDateTime(issue.created_at)}>{relativeTime(issue.created_at)}</td>
              <td className="num">
                {issue.status === "review" && <Link className="ed-link" href={href("/cms/library", { issue: issue.id })}>Candidates</Link>}
                {!demo && issue.status !== "review" && <Link className="ed-link" href={href(`/admin/${issue.id}`)}>Status<ArrowUpRight size={12} aria-hidden style={{ verticalAlign: -1, marginLeft: 2 }} /></Link>}
              </td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </Card>}
  </>;
}
