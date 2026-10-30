import "server-only";
import { cmsDb, databaseError } from "./db";
import { CmsError } from "./access";
import { canonicalPath, exportRedirects, normalizePath, type RedirectRow, type ResolvedRedirect } from "./redirects";
import type { CmsBrand, CmsJsonObject } from "./types";

function setupGuard(error: { code?: string }) {
  if (error.code === "PGRST202" || error.code === "42883" || error.code === "42P01") throw new CmsError(503, "Redirects are not set up yet: apply the cms_blocks_redirects_delivery migration.", "setup_required");
  databaseError(error);
}

export async function resolveRedirect(path: string, host: string | null): Promise<{ target: string | null; status: number; brand: CmsBrand } | null> {
  const { data, error } = await cmsDb().rpc("cms_resolve_redirect", { p_path: normalizePath(path), p_host: host });
  if (error) setupGuard(error);
  const row = (data as { target_path: string | null; status: number; brand: CmsBrand }[] | null)?.[0];
  return row ? { target: row.target_path, status: Number(row.status), brand: row.brand } : null;
}

export async function listRedirects(brands: CmsBrand[], query: string, limit = 200): Promise<ResolvedRedirect[]> {
  let request = cmsDb().from("cms_redirects").select("id,brand,legacy_host,legacy_path,target_path,document_id,status,source,hit_count,last_hit_at,created_at,cms_documents(brand,slug,metadata)").in("brand", brands).order("created_at", { ascending: false }).limit(Math.min(5000, limit));
  if (query) request = request.ilike("legacy_path", `%${query.replace(/[\\%_]/g, "\\$&")}%`);
  const { data, error } = await request;
  if (error) setupGuard(error);
  return ((data ?? []) as unknown as (RedirectRow & { cms_documents: { brand: CmsBrand; slug: string | null; metadata: CmsJsonObject } | null })[]).map(row => ({
    ...row, status: Number(row.status) as RedirectRow["status"],
    resolved_target: row.target_path ?? (row.cms_documents ? canonicalPath(row.cms_documents) : null),
  }));
}

export async function createRedirect(input: Omit<RedirectRow, "id">): Promise<RedirectRow> {
  const { data, error } = await cmsDb().from("cms_redirects").insert({ ...input, legacy_path: normalizePath(input.legacy_path) }).select("id,brand,legacy_host,legacy_path,target_path,document_id,status,source").single();
  if (error) setupGuard(error);
  return data as RedirectRow;
}

/** Insert rows, skipping any legacy path already mapped. Returns how many were added. */
export async function insertRedirects(rows: RedirectRow[]): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0, skipped = 0;
  for (let index = 0; index < rows.length; index += 200) {
    const batch = rows.slice(index, index + 200);
    const { data, error } = await cmsDb().from("cms_redirects").upsert(batch, { onConflict: "legacy_path", ignoreDuplicates: true }).select("id");
    if (error) {
      // The unique index is an expression index PostgREST cannot target; fall back to one-at-a-time inserts.
      for (const row of batch) {
        const single = await cmsDb().from("cms_redirects").insert(row);
        if (single.error) { if (single.error.code === "23505") skipped += 1; else setupGuard(single.error); } else inserted += 1;
      }
      continue;
    }
    inserted += data?.length ?? 0; skipped += batch.length - (data?.length ?? 0);
  }
  return { inserted, skipped };
}

export async function exportBrandRedirects(brands: CmsBrand[], format: "vercel" | "nginx" | "json" | "cloudfront"): Promise<string> {
  return exportRedirects(await listRedirects(brands, "", 5000), format);
}
