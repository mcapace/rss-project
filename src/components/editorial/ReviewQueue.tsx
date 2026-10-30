"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ClipboardCheck, PenLine } from "lucide-react";
import type { CmsSourceSystem } from "@/lib/cms/types";
import { CONTENT_TYPE_LABELS, SOURCE_SYSTEM_LABELS } from "@/lib/cms/organization";
import { relativeTime } from "@/lib/editorial/helpers";
import type { DocumentRow } from "@/lib/editorial/data";
import { useEditorial } from "./EditorialProvider";
import { useAsync } from "./hooks";
import { Button, Card, Chips, Empty, LinkButton, Notice, PageHeader, SkeletonRows, Tag } from "./ui";

const SOURCES: CmsSourceSystem[] = ["print", "morweb", "web_archive", "manual"];

export function ReviewQueue() {
  const { brand, data, href, toast, mutationVersion, refresh } = useEditorial();
  const queue = useAsync(`review-queue:${brand}:${mutationVersion}`, async signal => {
    const first = await data.listDocuments({ brand, state: "review" }, signal);
    const second = first.total > first.pageSize ? await data.listDocuments({ brand, state: "review", page: 2 }, signal) : null;
    return { rows: [...first.documents, ...(second?.documents ?? [])], total: first.total };
  });
  const issues = useAsync(`review-issues:${brand}:${mutationVersion}`, signal => data.listIssues(brand, signal));
  const [sources, setSources] = useState<CmsSourceSystem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const rows = useMemo(() => (queue.data?.rows ?? []).filter(row => !sources.length || sources.includes(row.source_system)).sort((a, b) => a.updated_at.localeCompare(b.updated_at)), [queue.data, sources]);
  const issueLabel = (id: string | null) => issues.data?.find(issue => issue.id === id)?.issue_label ?? null;
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; detail: string; rows: DocumentRow[]; issue?: string }>();
    for (const row of rows) {
      const key = row.issue_uuid ? `issue:${row.issue_uuid}` : `source:${row.source_system}`;
      const existing = map.get(key);
      if (existing) { existing.rows.push(row); continue; }
      map.set(key, row.issue_uuid
        ? { label: issueLabel(row.issue_uuid) ?? "Print issue", detail: "Candidates extracted from the print layout", rows: [row], issue: row.issue_uuid }
        : { label: SOURCE_SYSTEM_LABELS[row.source_system].short, detail: SOURCE_SYSTEM_LABELS[row.source_system].detail, rows: [row] });
    }
    return [...map.values()];
  }, [rows, issues.data]); // eslint-disable-line react-hooks/exhaustive-deps -- issueLabel reads issues.data

  async function moveToDraft(row: DocumentRow) {
    setBusy(row.id);
    try { await data.saveDocument(row.id, row.revision, { publication_state: "draft" }); toast("Moved to drafts", "success"); refresh(); }
    catch (error) { toast(error instanceof Error ? error.message : "Could not update the document.", "error"); }
    finally { setBusy(null); }
  }
  const oldest = rows[0];

  return <>
    <PageHeader icon={ClipboardCheck} title="Review queue" lede="Everything waiting on an editor, oldest first. Open a story to check it against its source, then move it on."
      actions={<LinkButton href={href("/cms/library", { state: "review" })} icon={ArrowRight}>Open in the library</LinkButton>}>
      <div className="ed-toolbar">
        <Chips label="Source" options={SOURCES.map(source => ({ id: source, label: SOURCE_SYSTEM_LABELS[source].short }))} selected={sources} onToggle={source => setSources(current => current.includes(source) ? current.filter(item => item !== source) : [...current, source])} />
        <span className="spacer" />
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{queue.data ? `${rows.length} of ${queue.data.total} waiting${oldest ? ` · longest ${relativeTime(oldest.updated_at)}` : ""}` : ""}</span>
      </div>
    </PageHeader>
    {queue.error && <div style={{ marginBottom: 16 }}><Notice tone="error">{queue.error}</Notice></div>}
    {queue.loading && !queue.data ? <Card><SkeletonRows rows={6} /></Card> : !groups.length ? <Card><Empty icon={ClipboardCheck} title="The queue is clear" text="New print candidates and changed imports appear here as soon as they arrive." /></Card> : <div className="ed-stack">
      {groups.map(group => <Card key={group.label + (group.issue ?? "")}>
        <div className="ed-section-head">
          <div><h2 className="ed-section-title">{group.label} <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {group.rows.length}</span></h2><p>{group.detail}</p></div>
          {group.issue && <LinkButton href={href("/cms/library", { issue: group.issue })} size="sm">All from this issue</LinkButton>}
        </div>
        <div className="ed-list">
          {group.rows.map(row => <div key={row.id} className="ed-row">
            <div className="grow">
              <Link className="title" href={href(`/cms/doc/${row.id}`)}>{row.title || "Untitled"}</Link>
              <span className="meta">{CONTENT_TYPE_LABELS[row.kind].singular}{row.byline ? ` · ${row.byline}` : ""} · waiting {relativeTime(row.updated_at).replace(" ago", "")}{row.excerpt ? ` · ${row.excerpt}` : ""}</span>
            </div>
            <Tag>{CONTENT_TYPE_LABELS[row.kind].singular}</Tag>
            <Button size="sm" variant="subtle" icon={PenLine} disabled={busy === row.id} onClick={() => moveToDraft(row)} title="Take it out of review and keep working">Draft</Button>
            <LinkButton href={href(`/cms/doc/${row.id}`)} size="sm">Review</LinkButton>
          </div>)}
        </div>
      </Card>)}
    </div>}
  </>;
}
