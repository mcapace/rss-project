import type { CmsBrand, CmsDocument } from "@/lib/cms/types";
import type { EditorialData } from "./data";
import { scheduleOf } from "./helpers";

/** Full documents cached by id and revision for the life of the page. */
const cache = new Map<string, CmsDocument>();

export const SCHEDULE_SCAN_LIMIT = 60;

async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export type ScheduledDocument = { document: CmsDocument; publishAt: string };

/**
 * Planned publish times live in each document's metadata, which the list
 * routes do not return. Scan the most recently edited drafts and review items
 * (bounded) and read their schedules, caching by revision.
 */
export async function loadScheduledDocuments(data: EditorialData, brand: CmsBrand, signal?: AbortSignal, limit = SCHEDULE_SCAN_LIMIT): Promise<{ scheduled: ScheduledDocument[]; scanned: number; truncated: boolean }> {
  const [drafts, review] = await Promise.all([
    data.listDocuments({ brand, state: "draft" }, signal),
    data.listDocuments({ brand, state: "review" }, signal),
  ]);
  const rows = [...drafts.documents, ...review.documents]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, limit);
  const documents = await mapWithConcurrency(rows, 6, async row => {
    const key = `${row.id}:${row.revision}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const { document } = await data.getDocument(row.id, signal);
    cache.set(key, document);
    return document;
  });
  const scheduled = documents
    .map(document => ({ document, publishAt: scheduleOf(document.metadata)?.publish_at ?? null }))
    .filter((entry): entry is ScheduledDocument => entry.publishAt !== null)
    .sort((a, b) => a.publishAt.localeCompare(b.publishAt));
  return { scheduled, scanned: rows.length, truncated: drafts.total + review.total > rows.length };
}

export function rememberDocument(document: CmsDocument) {
  cache.set(`${document.id}:${document.revision}`, document);
}
