import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * When a document is live on the public site, in one place.
 *
 * A document is live when publication_state is 'published' and published_at is empty (the imported stories and
 * ratings) or already past. cms_publish_document sets publication_state to 'published' at once and published_at to
 * the time an editor chose, so a scheduled story is 'published' with a time still ahead: it must stay off every public
 * surface (pages, lists, search, answers, similar stories, front-page pins) until that time. Editor routes under
 * /api/cms keep seeing scheduled items.
 *
 * Use onlyLive on a cms_documents query, onlyLiveJoined on a query that embeds cms_documents (for example
 * cms_ratings with cms_documents!inner), and isLive (or liveIds) on rows already fetched, such as the results of
 * wa_match_documents before 20261103180000_wa_match_live_only.sql is applied.
 */
export type LiveFields = { publication_state?: string | null; published_at?: string | null };

type When = Date | number;
const instant = (now: When) => (typeof now === "number" ? now : now.getTime());

/** The PostgREST `or` filter for "published_at is empty or not after now". */
export function liveFilter(now: When = Date.now()): string {
  return `published_at.is.null,published_at.lte.${new Date(instant(now)).toISOString()}`;
}

/** True when the row is published and its time has come (exactly now counts as live). */
export function isLive(row: LiveFields | null | undefined, now: When = Date.now()): boolean {
  if (!row || row.publication_state !== "published") return false;
  if (row.published_at == null || row.published_at === "") return true;
  const at = Date.parse(row.published_at);
  return Number.isFinite(at) && at <= instant(now);
}

/**
 * The two filter methods the helpers call. Every supabase-js filter builder has them, and both return the builder
 * itself (`this`), so the query keeps its own type. The helpers take the builder unconstrained: checking it against
 * even this small shape makes TypeScript expand a parsed select string's row type too deeply (TS2589).
 */
type Filters = { eq(column: string, value: string): Filters; or(filters: string, options?: { referencedTable?: string }): Filters };

/** Only live rows of a cms_documents query (a supabase-js filter builder, returned as it came). */
export function onlyLive<Q>(query: Q, now: When = Date.now()): Q {
  return (query as unknown as Filters).eq("publication_state", "published").or(liveFilter(now)) as unknown as Q;
}

/**
 * Only rows whose embedded cms_documents relation is live. Embed it with !inner (for example
 * `cms_documents!inner(slug,publication_state,published_at)`) so the parent row is dropped with its document.
 */
export function onlyLiveJoined<Q>(query: Q, relation = "cms_documents", now: When = Date.now()): Q {
  return (query as unknown as Filters).eq(`${relation}.publication_state`, "published").or(liveFilter(now), { referencedTable: relation }) as unknown as Q;
}

/** The ids among `ids` whose documents are live: one small query per hundred ids. */
export async function liveIds(db: SupabaseClient, ids: string[], now: When = Date.now()): Promise<Set<string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const live = new Set<string>();
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await db.from("cms_documents").select("id,publication_state,published_at").in("id", unique.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as (LiveFields & { id: string })[]) if (isLive(row, now)) live.add(row.id);
  }
  return live;
}
